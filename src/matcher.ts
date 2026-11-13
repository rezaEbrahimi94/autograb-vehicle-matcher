export interface MatchResult {
  vehicleId: string | null;
  confidence: number;
  candidateIds: string[];
  notes: string[];
  needsSemanticReview: boolean;
}

export function normalize(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\b(is|was|were|do|does|did|has|have|could|would|should)n't\b/g, '$1 not')
    .replace(/\bcan't\b/g, 'can not')
    .replace(/\beighty[ -]six\b/g, '86')
    .replace(/\bvw\b/g, 'volkswagen')
    .replace(/\bh\s*\/\s*line\b/g, 'highline')
    .replace(/\bblack\s+e\s*\/\s*d\b/g, 'black edition')
    .replace(/\br[ -]line\b/g, 'rline')
    .replace(/\bauto\b/g, 'automatic')
    .replace(/\b(?:4x4|4wd|awd)\b/g, 'four wheel drive')
    .replace(/\bfwd\b/g, 'front wheel drive')
    .replace(/\brwd\b/g, 'rear wheel drive')
    .replace(/\bfront[- ]wheel[- ]drive\b/g, 'front wheel drive')
    .replace(/\brear[- ]wheel[- ]drive\b/g, 'rear wheel drive')
    .replace(/\bfour[- ]wheel[- ]drive\b/g, 'four wheel drive')
    .replace(/\bsports\b/g, 'sport')
    .replace(/\s+/g, ' ')
    .trim();
}
