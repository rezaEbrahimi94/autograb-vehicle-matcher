import { required } from './invariant.js';
import { parseCatalogueFixture, json } from './contracts.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMatcher } from './matcher-factory.js';
const { vehicles } = parseCatalogueFixture(
  json(readFileSync(new URL('../test-data/catalogue.json', import.meta.url), 'utf8')),
);
void test('semantic cache still refreshes popularity and reports count failures', async () => {
  let reverse = false,
    fail = false;
  const m = createMatcher(vehicles, async (ids) => {
    if (fail) throw new Error('unavailable');
    return new Map(ids.map((id, i) => [id, reverse ? i : ids.length - i]));
  });
  const a = await m.match('Toyota 86 GT');
  reverse = true;
  const b = await m.match('Toyota 86 GT');
  assert.equal(a.candidateIds.length, 2);
  assert.deepEqual(a.candidateIds, b.candidateIds);
  assert.notEqual(a.vehicleId, b.vehicleId);
  assert.equal(m.stats.analysisComputations, 1);
  assert.equal(m.stats.countCalls, 2);
  fail = true;
  await assert.rejects(m.match('Toyota 86 GT'), /unavailable/);
});
void test('concurrent duplicates share analysis; negative inputs do not share meaning', async () => {
  const m = createMatcher(vehicles, async (ids) => new Map(ids.map((id) => [id, 0])));
  await Promise.all(Array.from({ length: 8 }, () => m.match('Toyota 86 GT Manual')));
  assert.equal(m.stats.analysisComputations, 1);
  assert.notEqual(
    (await m.match('Toyota 86 GT Automatic')).vehicleId,
    (await m.match('Toyota 86 GT not Automatic')).vehicleId,
  );
});
void test('confidence is bounded, missing information reduces certainty, unresolved input stays uncertain', async () => {
  const m = createMatcher(vehicles, async (ids) => new Map(ids.map((id) => [id, 0])));
  const partial = await m.match('Toyota 86 GT'),
    full = await m.match('Toyota 86 GT Manual Petrol Rear Wheel Drive');
  assert.ok(full.confidence > partial.confidence);
  for (const input of [
    '',
    'unclear words',
    'Toyota 86 GT Manual',
    'Toyota 86 GT Manual Automatic',
  ]) {
    const r = await m.match(input);
    assert.ok(Number.isFinite(r.confidence) && r.confidence >= 0 && r.confidence <= 10);
    if (r.vehicleId) assert.ok(vehicles.some((v) => v.id === r.vehicleId));
  }
  assert.ok((await m.match('unclear words')).confidence < 8);
  assert.equal((await m.match('x '.repeat(513))).vehicleId, null);
});
void test('catalogue validates IDs and attributes; listing counts must be valid', async () => {
  assert.throws(
    () => createMatcher([required(vehicles[0]), required(vehicles[0])], async () => new Map()),
    /unique/,
  );
  const m = createMatcher(vehicles, async () => new Map());
  await assert.rejects(m.match('Toyota 86 GT'), /listing count/);
});
