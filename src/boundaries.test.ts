import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ContractError,
  parseMatchRequest,
  parseMatchResponse,
  parseStatusResponse,
  parseVehicle,
  parseCountRow,
} from './contracts.js';
import { databaseConfig, parsePort } from './config.js';
import { createApi } from '../web/api.js';
const vehicle = {
  id: 'v1',
  make: 'Toyota',
  model: '86',
  badge: 'GT',
  transmission_type: 'Manual',
  fuel_type: 'Petrol',
  drive_type: 'Rear Wheel Drive',
};
const matched = {
  input: 'Toyota 86 GT',
  vehicleId: 'v1',
  confidence: 7,
  candidateIds: ['v1'],
  retrievedCandidateIds: ['v1'],
  notes: [],
  needsSemanticReview: false,
  vehicle,
};
const fingerprint = { catalogueHash: 'a'.repeat(64), listingCountsHash: 'b'.repeat(64) };
const status = {
  status: 'ready',
  catalogueRows: 81,
  loadedSourceHash: 'c'.repeat(64),
  currentSourceHash: 'c'.repeat(64),
  loadedFingerprint: fingerprint,
  currentFingerprint: fingerprint,
  activeRequests: 0,
  restartRequired: false,
};
void test('request contract rejects missing, empty, oversized and unknown fields', () => {
  for (const value of [
    null,
    [],
    {},
    { input: '' },
    { input: ' '.repeat(4) },
    { input: 'x'.repeat(10001) },
    { input: 'Toyota', vehicleId: 'forced' },
  ])
    assert.throws(() => parseMatchRequest(value), ContractError);
  assert.deepEqual(parseMatchRequest({ input: ' Toyota ' }), { input: ' Toyota ' });
});
void test('response contract validates confidence and selected vehicle consistency', () => {
  assert.deepEqual(parseMatchResponse(matched), matched);
  for (const confidence of [-1, 11, NaN, Infinity, '9'])
    assert.throws(() => parseMatchResponse({ ...matched, confidence }), ContractError);
  for (const patch of [
    { vehicle: null },
    { vehicleId: null },
    { candidateIds: [] },
    { candidateIds: ['v1', 'v1'] },
    { notes: [7] },
    { needsSemanticReview: 'false' },
  ])
    assert.throws(() => parseMatchResponse({ ...matched, ...patch }), ContractError);
  assert.equal(
    parseMatchResponse({
      ...matched,
      vehicleId: null,
      vehicle: null,
      candidateIds: [],
      confidence: 2,
    }).vehicleId,
    null,
  );
});
void test('status contract rejects invalid fingerprints and operational counters', () => {
  assert.deepEqual(parseStatusResponse(status), status);
  for (const patch of [
    { status: 'unknown' },
    { activeRequests: 5 },
    { activeRequests: -1 },
    { catalogueRows: 1.5 },
    { loadedSourceHash: 'bad' },
    { restartRequired: 'false' },
  ])
    assert.throws(() => parseStatusResponse({ ...status, ...patch }), ContractError);
});
void test('SQL row contracts reject malformed catalogue fields and unsafe counts', () => {
  assert.deepEqual(parseVehicle(vehicle), vehicle);
  assert.throws(() => parseVehicle({ ...vehicle, fuel_type: null }), ContractError);
  assert.throws(() => parseVehicle({ ...vehicle, id: 123 }), ContractError);
  assert.deepEqual(parseCountRow({ id: 'v1', count: '12' }), { id: 'v1', count: 12 });
  for (const count of ['-1', '1.5', '9007199254740992', 'NaN', 4])
    assert.throws(() => parseCountRow({ id: 'v1', count }), ContractError);
});
void test('configuration rejects malformed ports and database URLs without echoing secrets', () => {
  assert.equal(parsePort(undefined, 5432), 5432);
  const config = databaseConfig({ PGHOST: '/tmp/postgres', PGPORT: '55439', PGDATABASE: 'test' });
  assert.ok('port' in config);
  assert.equal(config.port, 55439);
  for (const port of ['', '-1', '0', '1.2', '65536', '5432abc'])
    assert.throws(() => parsePort(port, 5432));
  for (const DATABASE_URL of [
    'password-secret',
    'https://user:password-secret@example.test/db',
    'postgresql://localhost',
  ])
    assert.throws(
      () => databaseConfig({ DATABASE_URL }),
      (error) => error instanceof Error && !error.message.includes('password-secret'),
    );
  assert.equal(databaseConfig({ DATABASE_URL: 'postgresql://localhost/test' }).max, 8);
});
void test('typed client validates response data and propagates cancellation signal', async () => {
  const abort = new AbortController();
  const client = createApi(async (path, init) => {
    assert.equal(path, '/api/match');
    assert.equal(init?.signal, abort.signal);
    assert.equal(init?.body, JSON.stringify({ input: 'Toyota 86 GT' }));
    return new Response(JSON.stringify(matched));
  });
  assert.deepEqual(await client.match('Toyota 86 GT', abort.signal), matched);
  assert.deepEqual(
    await createApi(async () => new Response(JSON.stringify(status))).status(),
    status,
  );
});
void test('typed client rejects malformed JSON, malformed success and server errors', async () => {
  await assert.rejects(
    createApi(async () => new Response('not json')).status(),
    /invalid response/,
  );
  await assert.rejects(createApi(async () => new Response('{}')).match('Toyota'), ContractError);
  await assert.rejects(
    createApi(
      async () => new Response(JSON.stringify({ error: 'Busy; retry shortly.' }), { status: 429 }),
    ).match('Toyota'),
    /Busy/,
  );
  await assert.rejects(
    createApi(async () => new Response('{}', { status: 500 })).match('Toyota'),
    /request failed/,
  );
  const client = createApi(async () => {
    throw new Error('Network unavailable');
  });
  await assert.rejects(client.status(), /Network unavailable/);
});
