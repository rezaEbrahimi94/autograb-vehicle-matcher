/** Compare scoped observations against catalogue records. Explicit identity,
 * grade and field constraints remain authoritative; listing popularity is
 * applied separately only after the complete semantic tie set is known. */
type Field = 'make' | 'model' | 'badge' | 'transmission_type' | 'fuel_type' | 'drive_type';
export type Observation = {
  entry: { field: Field; value: string; ids: ReadonlySet<string> };
  quality: number;
};
export class CandidateEvidenceIndex {
  private readonly families = new Set<string>();
  constructor(badges: Iterable<string>) {
    for (const badge of badges)
      for (const word of badge.toLowerCase().split(' ')) {
        const prefix = /^([a-z]+)\d+$/.exec(word),
          suffix = /^\d+([a-z]+)$/.exec(word);
        if (prefix) this.families.add(`prefix:${prefix[1]}`);
        if (suffix) this.families.add(`suffix:${suffix[1]}`);
      }
  }
  isDesignation(word: string): boolean {
    const prefix = /^([a-z]+)\d+$/.exec(word),
      suffix = /^\d+([a-z]+)$/.exec(word);
    return !!(
      (prefix && this.families.has(`prefix:${prefix[1]}`)) ||
      (suffix && this.families.has(`suffix:${suffix[1]}`))
    );
  }
  isDesignationFamily(word: string): boolean {
    return this.families.has(`prefix:${word}`) || this.families.has(`suffix:${word}`);
  }
  compare(
    positive: Observation[],
    negative: Observation[],
    completeBadge: ReadonlySet<string> | undefined,
    assertAllDesignations = false,
  ) {
    const identity = positive.filter((e) => e.entry.field === 'make' || e.entry.field === 'model');
    const seed = identity.reduce((best, e) => (e.entry.ids.size < best.entry.ids.size ? e : best));
    const candidates = [...seed.entry.ids].filter((id) =>
      identity.every((e) => e.entry.ids.has(id)),
    );
    // Compare badge evidence within the identified model family. Cross-model
    // catalogue word collisions are non-evidence unless the caller identified
    // a direct badge assertion (which is checked before comparison).
    const relevant = positive.filter(
      (e) =>
        assertAllDesignations ||
        e.entry.field !== 'badge' ||
        candidates.some((id) => e.entry.ids.has(id)),
    );
    const ignored = positive.filter((e) => !relevant.includes(e));
    const weights: Record<Field, number> = {
      make: 6,
      model: 12,
      badge: 5,
      transmission_type: 4,
      fuel_type: 4,
      drive_type: 4,
    };
    const scored = relevant.map((e) => ({
      e,
      weight:
        weights[e.entry.field] +
        Math.log2(
          1 +
            candidates.length / Math.max(1, candidates.filter((id) => e.entry.ids.has(id)).length),
        ),
    }));
    const winners: string[] = [];
    let best = -Infinity;
    for (const id of candidates) {
      if (completeBadge && !completeBadge.has(id)) continue;
      if (relevant.some((e) => e.quality === 1 && !e.entry.ids.has(id))) continue;
      if (negative.some((e) => e.entry.ids.has(id))) continue;
      const score = scored.reduce(
        (sum, { e, weight }) => sum + (e.entry.ids.has(id) ? 1 : -1) * weight * e.quality,
        0,
      );
      if (score > best + 1e-9) {
        best = score;
        winners.length = 0;
        winners.push(id);
      } else if (Math.abs(score - best) < 1e-9) winners.push(id);
    }
    return {
      candidateIds: winners,
      retrievedCandidateIds: candidates,
      ignoredObservations: ignored.length,
    };
  }
}
