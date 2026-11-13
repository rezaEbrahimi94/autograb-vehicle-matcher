import { required } from './invariant.js';
/** A modification noun phrase can contain an unknown technical/brand modifier.
 * This annotates prose only: recognized fuel/gearbox/badge claims are never
 * removed, and letter-digit designation families stay explicit constraints. */
export function modificationModifierSpans(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  const phrases =
    /\b([a-z]{2,12})\s+(engine|transmission|gearbox|motor)(\s*(?:&|and)\s*(?:engine|transmission|gearbox|motor))?\s+(?:tune|tuning|remap|upgrade|cooler|cooling)\b/g;
  for (const phrase of text.matchAll(phrases)) {
    if (
      /^(?:edition|package|grade|trim|badge|model|variant|not|no|non|actual|unsupported)$/.test(
        required(phrase[1]),
      )
    )
      continue;
    const prefix = text.slice(Math.max(0, phrase.index - 40), phrase.index);
    if (/\b(?:edition|package|grade|trim|badge|model|variant)\s*[:=]?\s*$/.test(prefix)) continue;
    // Bare unfamiliar words beside a single component can still be a named
    // variant. Require coordinated technical heads or an explicit equipment cue.
    if (!phrase[3] && !/\b(?:with|fitted|equipped|modified|upgraded)\s+(?:with\s+)?$/.test(prefix))
      continue;
    spans.push({ start: phrase.index, end: phrase.index + required(phrase[1]).length });
  }
  return spans;
}
/** Finite personal reason clauses end a preceding nominal equipment phrase;
 * an identity predicate ('package is the actual trim') does not. */
export function subordinateEquipmentBoundary(tail: string): boolean {
  return /^\s+(?:because|although|while|when|as)\s+(?:i|we|you|they|he|she)\b/.test(tail);
}
