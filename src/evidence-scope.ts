/** Assign a lexical observation to a subject/role before candidate comparison.
 * The small head lexicon describes components, never vehicle IDs or listings.
 * Explicit gearbox heads and clause boundaries prevent blanket suppression. */
export type ClaimScope = {
  role: 'target' | 'equipment' | 'comparison' | 'desired' | 'attribute-modifier';
  head?: string;
};
const components = new Set(
  'seat seats headlight headlights headlamp headlamps light lights wiper wipers window windows mirror mirrors door doors tailgate sunroof climate airconditioning adjustment adjustable mode infotainment'.split(
    ' ',
  ),
);
const gearbox = new Set(['gearbox', 'transmission', 'clutch', 'gears']);
const barriers = new Set([
  'and',
  'but',
  'or',
  'however',
  'whereas',
  'is',
  'are',
  'was',
  'were',
  'has',
  'have',
  'manual',
  'automatic',
]);
export function claimScope(
  text: string,
  start: number,
  end: number,
  field: string,
  clause: { start: number; end: number },
  typedFields = false,
  identityInClause = false,
  attachmentBarriers?: { start: number; end: number }[],
): ClaimScope {
  const prefix = text.slice(clause.start, start);
  // Roles attach to the mention, not all earlier words in the sentence. Existing
  // correction/target segmentation bounds these spans before this stage.
  if (/\b(?:unlike|versus|vs|compared (?:to|with)|rather than)\b[^;.!?]*$/.test(prefix))
    return { role: 'comparison' };
  if (/\b(?:want|wants|wanting|wish|wishing|prefer|preferring|hoping)\b[^;.!?]*$/.test(prefix))
    return { role: 'desired' };
  if (typedFields && field === 'badge') {
    // In a typed transmission description, a grade-like word modifies that
    // attribute. An explicit trim/grade header starts a different subject.
    const header =
      /\b(?:transmission|gearbox)\s*:[^;.!?]*$/.test(prefix) &&
      !/\b(?:badge|grade|trim)\s*[:=]/.test(prefix);
    const tail = text.slice(end, clause.end);
    const headed =
      /^\s+(?:(?:automatic|manual|[0-9]+|speed)\s+){0,3}(?:transmission|gearbox)\b/.test(tail);
    if (header || (headed && !identityInClause))
      return { role: 'attribute-modifier', head: 'transmission' };
  }
  if (field !== 'transmission_type' && field !== 'fuel_type') return { role: 'target' };
  const words = [...text.slice(clause.start, clause.end).matchAll(/[a-z0-9]+/g)].map((m) => ({
    word: m[0],
    start: clause.start + m.index,
    end: clause.start + m.index + m[0].length,
  }));
  const left = words.filter((t) => t.end <= start),
    right = words.filter((t) => t.start >= end);
  if (left.at(-1)?.word === 'android') return { role: 'equipment', head: 'android auto' };
  if (
    field === 'transmission_type' &&
    (gearbox.has(left.at(-1)?.word ?? '') ||
      gearbox.has(right[0]?.word ?? '') ||
      (gearbox.has(left.at(-2)?.word ?? '') &&
        ['is', 'was', 'type'].includes(left.at(-1)?.word ?? '')))
  )
    return { role: 'target' };
  for (const direction of [[...left].reverse(), right]) {
    const gap: string[] = [];
    for (const token of direction.slice(0, 7)) {
      // Independent structured fields and capacity numerals cannot be crossed
      // to attach a powertrain adjective to a nearby seat/window noun.
      if (
        attachmentBarriers &&
        (/\d/.test(token.word) ||
          attachmentBarriers.some((e) => token.start >= e.start && token.end <= e.end))
      )
        break;
      if (components.has(token.word)) return { role: 'equipment', head: token.word };
      if (barriers.has(token.word) || gearbox.has(token.word)) break;
      gap.push(token.word);
      if (gap.length > 5) break;
    }
  }
  return { role: 'target' };
}

/** Nominal equipment spans, including donor identities and postmodifiers.
 * Strong clause/list boundaries and explicit powertrain heads stop attachment.
 * This is a bounded grammar, not a statistical dependency parser. */
export function componentSpans(
  text: string,
  functionHeads = false,
  brakeHeads = false,
  equipmentOntology = false,
): { start: number; end: number }[] {
  const result: { start: number; end: number }[] = [];
  const baseHead =
    /\b(?:wheels?|rims?|seats?|headlights?|headlamps?|wipers?|mirrors?|sunroof|caps|air conditioning|roll cover|roof rack|steering wheel|seat adjustment)\b/g;
  // Anti-glare names an optical equipment function even if its noun is elided.
  const head = new RegExp(
    baseHead.source.replace(
      '(?:wheels?',
      `(?:${functionHeads ? 'anti[- ]glare|' : ''}${brakeHeads ? 'brakes?|rotors?|discs?|pads|' : ''}${equipmentOntology ? 'steering|suspension|dampers?|shocks?|springs?|tyres?|tires?|upholstery|interior|exterior|styling|lighting|lamps?|foglights?|windows?|ventilation|audio|sound system|stereo|radio|speakers?|display|screen|navigation|cruise control|parking assist|sensors?|cameras?|locks?|roof|covers?|pedals?|' : ''}wheels?`,
    ),
    'g',
  );
  for (const clause of text.matchAll(/[^;.!?\n]+/g)) {
    const origin = clause.index;
    for (const match of clause[0].matchAll(head)) {
      const headStart = origin + match.index,
        headEnd = headStart + match[0].length;
      if (/^\s+drive\b/.test(text.slice(headEnd))) continue;
      const prefix = text.slice(origin, headStart);
      const boundaryPattern = equipmentOntology
        ? /[:,|*]|\s-\s|\b(?:with|and|include|includes|fitted|has|have|features|featuring|equipped)\b/g
        : /[:,|*]|\s-\s|\b(?:with|and|include|includes|fitted)\b/g;
      const boundaries = [...prefix.matchAll(boundaryPattern)];
      const boundary = boundaries
        .filter(
          (b) =>
            b[0] !== 'and' ||
            /\b(?:seats?|wheels?|mirrors?|lights?|adjustment)\b/.test(prefix.slice(0, b.index)),
        )
        .at(-1);
      const start = boundary ? origin + boundary.index + boundary[0].length : origin;
      const before = text.slice(start, headStart);
      if (
        before.trim().split(/\s+/).length > 14 ||
        /\b(?:is|are|was|were|has|have|gearbox|transmission|diesel|petrol|hybrid)\b/.test(before)
      )
        continue;
      // A standalone vehicle gearbox before a component is not its modifier.
      if (
        /\b(?:manual|automatic)\b/.test(before) &&
        !/^\s*(?:standard\s+)?(?:manual|automatic)\b/.test(before)
      )
        continue;
      const post = /^\s*\(\s*(?:manual|automatic)\s*\)/.exec(text.slice(headEnd));
      result.push({ start, end: headEnd + (post?.[0].length ?? 0) });
    }
  }
  return result;
}
