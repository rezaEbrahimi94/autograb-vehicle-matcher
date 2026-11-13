/** Shared runtime contracts: the server and browser validate the same shapes. */
export class ContractError extends Error {
  override readonly name = 'ContractError';
}
export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new ContractError('Expected an object.');
  return Object.fromEntries(Object.entries(value));
}
export function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new ContractError('Expected nonempty text.');
  return value;
}
export function integer(value: unknown, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum)
    throw new ContractError('Expected a safe integer.');
  return value;
}
export function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new ContractError('Expected a boolean.');
  return value;
}
export function strings(value: unknown): string[] {
  if (!Array.isArray(value)) throw new ContractError('Expected an array.');
  return value.map((item: unknown) => text(item));
}
export function hash(value: unknown): string {
  const result = text(value);
  if (!/^[a-f0-9]{64}$/.test(result)) throw new ContractError('Expected a SHA-256 hash.');
  return result;
}
export function json(textValue: string): unknown {
  const value: unknown = JSON.parse(textValue);
  return value;
}
export function parseVehicle(value: unknown) {
  const row = record(value);
  return {
    id: text(row.id),
    make: text(row.make),
    model: text(row.model),
    badge: text(row.badge),
    transmission_type: text(row.transmission_type),
    fuel_type: text(row.fuel_type),
    drive_type: text(row.drive_type),
  };
}
export type Vehicle = ReturnType<typeof parseVehicle>;
export function parseMatchRequest(value: unknown) {
  const row = record(value);
  if (Object.keys(row).some((k) => k !== 'input'))
    throw new ContractError('Unexpected request field.');
  const input = text(row.input);
  if (input.length > 10000) throw new ContractError('Input exceeds 10,000 characters.');
  return { input };
}
export type MatchRequest = ReturnType<typeof parseMatchRequest>;
export function parseFingerprint(value: unknown) {
  const row = record(value);
  return { catalogueHash: hash(row.catalogueHash), listingCountsHash: hash(row.listingCountsHash) };
}
export function parseMatchResponse(value: unknown) {
  const row = record(value),
    input = text(row.input);
  const vehicleId = row.vehicleId === null ? null : text(row.vehicleId);
  const confidence = row.confidence;
  if (
    typeof confidence !== 'number' ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 10
  )
    throw new ContractError('Invalid confidence.');
  const candidateIds = strings(row.candidateIds),
    retrievedCandidateIds = strings(row.retrievedCandidateIds);
  if (new Set(candidateIds).size !== candidateIds.length)
    throw new ContractError('Duplicate candidate IDs.');
  const vehicle = row.vehicle === null ? null : parseVehicle(row.vehicle);
  if (
    vehicleId === null
      ? vehicle !== null
      : vehicle?.id !== vehicleId || !candidateIds.includes(vehicleId)
  )
    throw new ContractError('Inconsistent selected vehicle.');
  return {
    input,
    vehicleId,
    confidence,
    candidateIds,
    retrievedCandidateIds,
    notes: strings(row.notes),
    needsSemanticReview: boolean(row.needsSemanticReview),
    vehicle,
  };
}
export type MatchResponse = ReturnType<typeof parseMatchResponse>;
export function parseStatusResponse(value: unknown) {
  const row = record(value);
  if (row.status !== 'ready') throw new ContractError('Invalid service status.');
  const activeRequests = integer(row.activeRequests);
  if (activeRequests > 4) throw new ContractError('Invalid active request count.');
  return {
    status: 'ready' as const,
    catalogueRows: integer(row.catalogueRows),
    loadedSourceHash: hash(row.loadedSourceHash),
    currentSourceHash: hash(row.currentSourceHash),
    loadedFingerprint: parseFingerprint(row.loadedFingerprint),
    currentFingerprint: parseFingerprint(row.currentFingerprint),
    activeRequests,
    restartRequired: boolean(row.restartRequired),
  };
}
export type StatusResponse = ReturnType<typeof parseStatusResponse>;
export function parseApiError(value: unknown) {
  const row = record(value);
  return { error: text(row.error) };
}
export function parseCountRow(value: unknown) {
  const row = record(value),
    count = text(row.count);
  if (!/^[0-9]+$/.test(count)) throw new ContractError('Invalid listing count.');
  return { id: text(row.id), count: integer(Number(count)) };
}
export function parseCatalogueFixture(value: unknown) {
  const row = record(value);
  if (!Array.isArray(row.vehicles)) throw new ContractError('Invalid fixture vehicles.');
  const counts = Object.fromEntries(
    Object.entries(record(row.counts)).map(([id, count]) => [id, integer(count)]),
  );
  return {
    sourceSqlSha256: hash(row.sourceSqlSha256),
    vehicles: row.vehicles.map((v: unknown) => parseVehicle(v)),
    counts,
  };
}
