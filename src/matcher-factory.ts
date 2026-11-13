import { VehicleMatcher, type MatcherOptions } from './vehicle-matcher.js';
import type { Vehicle } from './db.js';
export function createMatcher(
  vehicles: Vehicle[],
  counts: (ids: string[]) => Promise<Map<string, number>>,
  options: MatcherOptions = {},
) {
  return new VehicleMatcher(vehicles, counts, options);
}
export const MATCHING_RUNTIME_FILES = [
  'src/matcher.ts',
  'src/vehicle-matcher.ts',
  'src/candidate-evidence.ts',
  'src/evidence-scope.ts',
  'src/interpretation-relations.ts',
  'src/evidence-composition.ts',
  'src/listing-structure.ts',
  'src/mention-context.ts',
  'src/nominal-context.ts',
  'src/matcher-factory.ts',
  'src/db.ts',
  'src/contracts.ts',
  'src/config.ts',
  'src/invariant.ts',
  'src/server.ts',
  'src/cli.ts',
  'web/api.ts',
  'web/app.ts',
];
