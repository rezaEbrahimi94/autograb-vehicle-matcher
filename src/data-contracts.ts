import { record, text, strings, integer, hash, parseVehicle, ContractError } from './contracts.js';
import type { Vehicle } from './contracts.js';
export const VEHICLE_FIELDS = [
  'make',
  'model',
  'badge',
  'transmission_type',
  'fuel_type',
  'drive_type',
] as const;
export function parseFixtures(value: unknown) {
  if (!Array.isArray(value)) throw new ContractError('Expected fixture array.');
  return value.map((entry: unknown) => {
    const row = record(entry),
      raw = record(row.expected);
    const expected: Partial<Omit<Vehicle, 'id'>> & { id?: string | null } = {};
    for (const key of Object.keys(raw))
      if (key !== 'id' && !VEHICLE_FIELDS.some((field) => field === key))
        throw new ContractError('Unknown expected field.');
    for (const field of VEHICLE_FIELDS)
      if (raw[field] !== undefined) expected[field] = text(raw[field]);
    if ('id' in raw) expected.id = raw.id === null ? null : text(raw.id);
    return {
      name: text(row.name),
      input: text(row.input),
      split: text(row.split),
      category: text(row.category),
      expected,
      ...(row.equivalentIds === undefined ? {} : { equivalentIds: strings(row.equivalentIds) }),
    };
  });
}
export function parsePublicListings(value: unknown) {
  const data = record(value);
  if (!Array.isArray(data.cases)) throw new ContractError('Expected cases.');
  return {
    description: text(data.description),
    cases: data.cases.map((entry: unknown) => {
      const row = record(entry),
        source = text(row.source);
      const url = new URL(source);
      if (!['https:', 'http:'].includes(url.protocol))
        throw new ContractError('Invalid source URL.');
      return {
        case: integer(row.case, 1),
        source,
        input: text(row.input),
        expected: row.expected === null ? null : text(row.expected),
        expectedCandidates: strings(row.expectedCandidates),
        reason: text(row.reason),
      };
    }),
  };
}
export function parseCatalogueData(value: unknown) {
  const row = record(value);
  if (!Array.isArray(row.vehicles)) throw new ContractError('Invalid catalogue fixture.');
  return {
    sourceSqlSha256: hash(row.sourceSqlSha256),
    vehicles: row.vehicles.map((v: unknown) => parseVehicle(v)),
    counts: Object.fromEntries(
      Object.entries(record(row.counts)).map(([id, count]) => [id, integer(count)]),
    ),
  };
}
