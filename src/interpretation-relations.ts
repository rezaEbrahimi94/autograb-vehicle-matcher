/** Bounded relation annotation after lexical detection, before catalogue constraints.
 * Offsets refer to normalized text. No vehicle values, IDs or source sentences.
 * A transaction/transition complement has its own entity; an equipment head has
 * its own attribute modifiers. Neither is evidence about the sale vehicle. */
export type RelationSpan = {
  start: number;
  end: number;
  role: 'other-entity' | 'equipment';
  head: string;
};
export type IdentitySpan = { start: number; end: number };
export function presentationEnd(prefix: string): number | undefined {
  // This affirmative imperative contains lexical "no", not vehicle negation.
  // Require a deictic complement; a bare wanted question remains a wanted ad.
  const match = /\blook no further than\s+(?:this|our|the following)\s+/.exec(prefix);
  return match ? match.index + match[0].length : undefined;
}
const POWERTRAIN =
  /\b(?:engine|transmission|gearbox|powertrain|drivetrain|drive motor|traction motor|traction battery|converted?|conversion)\b/;
export function entityRelations(
  text: string,
  identities: IdentitySpan[],
  typedObjects?: { field: string; start: number; end: number }[],
): RelationSpan[] {
  const spans: RelationSpan[] = [];
  // Events are deliberately separated from object spans: "I bought THIS Golf"
  // remains target evidence; "bought A NEW Golf" can refer to another vehicle
  // only if an independent earlier identity exists.
  const events =
    /\b(?:(?:bought|purchased|acquired|ordered)\s+(?:(?:my|our)\s+)?(?:a\s+new|an?\s+replacement|another|a\s+different)|(?:mov(?:e|ing)|switch(?:ing)?|chang(?:e|ing)|upgrad(?:e|ing)|downsiz(?:e|ing))\s+to\s+(?:(?:an?|another|the)\s+)?)\b/g;
  const eventPattern = typedObjects
    ? new RegExp(
        events.source.replace(
          'a\\s+new|an?\\s+replacement|another|a\\s+different',
          'an?(?:\\s+(?:new|replacement|different))?|another',
        ),
        'g',
      )
    : events;
  for (const event of text.matchAll(eventPattern)) {
    const eventStart = event.index,
      objectStart = eventStart + event[0].length;
    const clauseStart =
      Math.max(
        text.lastIndexOf(';', eventStart),
        text.lastIndexOf('.', eventStart),
        text.lastIndexOf('!', eventStart),
        text.lastIndexOf('?', eventStart),
      ) + 1;
    const before = text.slice(clauseStart, eventStart);
    const transaction = /^(?:bought|purchased|acquired|ordered)\b/.test(event[0]);
    // An ownership transition requires a human/sale-purpose subject. Vehicle
    // conversions and component replacements are actual target assertions.
    if (
      POWERTRAIN.test(before) ||
      (!transaction && !/\b(?:i|we|selling|sell|sale|reason|owner)\b/.test(before))
    )
      continue;
    if (!identities.some((e) => e.end <= eventStart)) continue;
    let end = text.length;
    const suffix = text.slice(objectStart);
    const stop =
      /[;.!?,]|\b(?:but|however|whereas|correction|actually|for sale|selling|this (?:car|vehicle) (?:is|has)|it (?:is|has))\b/.exec(
        suffix,
      );
    if (stop) end = objectStart + stop.index;
    const objectIdentity = identities
      .filter((e) => e.start >= objectStart && e.end <= end)
      .sort((a, b) => a.start - b.start)[0];
    const objectPrefix = text.slice(objectStart, objectIdentity?.start ?? end);
    const component = POWERTRAIN.exec(objectPrefix),
      vehicleHead = /\b(?:car|vehicle|suv|wagon|ute|truck)\b/.exec(objectPrefix);
    if (component && (!vehicleHead || component.index < vehicleHead.index)) continue;
    if (typedObjects) {
      const typedVehicle =
        !!objectIdentity ||
        !!vehicleHead ||
        typedObjects.some(
          (e) =>
            e.start >= objectStart && e.end <= end && ['drive_type', 'fuel_type'].includes(e.field),
        );
      if (!typedVehicle) continue;
    }
    if (end > objectStart)
      spans.push({
        start: objectStart,
        end,
        role: 'other-entity',
        head: transaction ? 'purchase object' : 'transition destination',
      });
  }
  return spans;
}

/** Nominal modifier attachment, bounded by punctuation, prepositions and finite
 * predicates. Functional compounds provide their head: temperature CONTROL,
 * side STEPS, window MOTOR; drive/traction motor remain vehicle powertrain. */
export function equipmentRelations(text: string, closureHeads = false): RelationSpan[] {
  const result: RelationSpan[] = [];
  const heads =
    /\b(?:temperature control|climate control|air conditioning|side ?steps?|running boards?|window motors?|window regulators?|door actuators?|seat motors?|seat adjustment|tailgate|liftgate|boot release|steering|parking brake|handbrake|parking sensors?|parking assist|central locking)\b/g;
  const headPattern = closureHeads
    ? new RegExp(
        heads.source.replace(
          '(?:temperature',
          '(?:shutters?|blinds?|curtains?|tonneaus?|temperature',
        ),
        'g',
      )
    : heads;
  for (const match of text.matchAll(headPattern)) {
    const headStart = match.index,
      headEnd = headStart + match[0].length;
    const prefix = text.slice(0, headStart),
      boundaries = [
        ...prefix.matchAll(
          /[;.!?,:|]|\b(?:with|and|but|or|has|have|is|are|was|were|features|includes|fitted|equipped)\b/g,
        ),
      ];
    const last = boundaries.at(-1),
      start = last ? last.index + last[0].length : 0;
    const modifiers = text.slice(start, headStart);
    if (
      modifiers.trim().split(/\s+/).length > 6 ||
      POWERTRAIN.test(modifiers) ||
      /\b(?:petrol|diesel|hybrid|drive)\b/.test(modifiers)
    )
      continue;
    result.push({ start, end: headEnd, role: 'equipment', head: match[0] });
  }
  return result;
}

// DENSO Australia application catalogue2024, printed p83 (PDF43 zero-based).
// These associations identify metadata only: never infer grade,fuel,drive oryear.
// https://am.denso.com/plug-global/wp-content/uploads/sites/23/catalog_2_australia_2024.pdf
export const RELATION_MODEL_METADATA: Record<string, { make: string; model: string }> =
  Object.fromEntries(
    ['gsu40r', 'gsu45r', 'gsu50r', 'gsu55r'].map((code) => [
      code,
      { make: 'toyota', model: 'kluger' },
    ]),
  );
