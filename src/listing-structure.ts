/** Preserve seller-list/clause structure before normalization destroys layout.
 * Separators add no vehicle facts. In-word hyphens (GT-S, Hybrid-Diesel), decimal
 * numbers and ordinary multiplication/tyre counts remain untouched. */
export function structuredListingText(input: string): string {
  return (
    input
      .normalize('NFKC')
      .replace(/\s+[-‐‑‒–—−]\s+/gu, '; ')
      .replace(/[•‣⁃●▪◦]+/gu, '; ')
      .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]+/gu, '; ')
      // Wheel notation is a drive fact, not a model-dependent front-drive guess.
      // Existing @2wd postings include both front and rear driven catalogue rows.
      .replace(/\b4\s*[x×]\s*([24])\b/gi, (_all, wheels: string) =>
        wheels === '2' ? '2wd' : '4wd',
      )
  );
}
