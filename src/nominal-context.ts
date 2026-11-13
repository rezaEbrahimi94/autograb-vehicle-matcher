import { required } from './invariant.js';
/** Local grammatical roles. These helpers classify local syntax, never vehicle IDs. */
export function additiveCoordinator(
  text: string,
  start: number,
  end: number,
  completeBase = false,
): boolean {
  // Plus attached to a grade remains a grade. A separated coordinator followed
  // by a quantified/determined noun phrase is additive equipment/sales prose.
  return (
    (completeBase || /(?:^|[,;:])\s*$/.test(text.slice(0, start))) &&
    /^\s+(?:other|additional|more|some|many|all|the|a|an)\b/.test(text.slice(end))
  );
}
export function conditionBoundary(tail: string): boolean {
  return /^\s+(?:(?:excellent|great|good|pristine|immaculate|original|mint)\s+condition|(?:full|complete)\s+service\s+history)\b/.test(
    tail,
  );
}
export function closedGradeExtension(
  text: string,
  end: number,
): { start: number; end: number } | undefined {
  const tail = text.slice(end);
  const m =
    /^\s+([a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,2}?)(?=\s+(?:coupe|sedan|hatchback|suv|wagon|ute|convertible|edition|trim|grade)\b|\s*(?:$|[.;|]))/.exec(
      tail,
    );
  if (!m) return;
  if (
    required(m[1]).includes(' ') &&
    !/^\s+(?:coupe|sedan|hatchback|suv|wagon|ute|convertible|edition|trim|grade)\b/.test(
      tail.slice(m[0].length),
    )
  )
    return;
  const words = required(m[1]).split(/\s+/);
  // Attribute/commercial heads give the preceding adjective an ordinary role.
  // A body-type/grade head or closed title instead preserves the named suffix.
  if (
    words.some((w) =>
      /^(?:one|ones|with|and|for|in|on|is|has|model|sale|sold|offer|time|kilometres|kilometers|kms|warranty|condition|history|differential|seats|features|paint|painted|colour|color)$/.test(
        w,
      ),
    )
  )
    return;
  const start = end + m[0].indexOf(required(m[1]));
  return { start, end: start + required(m[1]).length };
}
