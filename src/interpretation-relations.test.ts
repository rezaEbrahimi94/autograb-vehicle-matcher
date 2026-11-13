import { required } from './invariant.js';
import { parseCatalogueFixture, json } from './contracts.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VehicleMatcher } from './vehicle-matcher.js';
import {
  entityRelations,
  equipmentRelations,
  presentationEnd,
} from './interpretation-relations.js';
const { vehicles, counts } = parseCatalogueFixture(
  json(readFileSync(new URL('../test-data/catalogue.json', import.meta.url), 'utf8')),
);
const make = () =>
  new VehicleMatcher(vehicles, async (ids) => new Map(ids.map((id) => [id, counts[id] ?? 0])), {
    cacheSize: 0,
  });
const identity = 'Toyota 86 GT Manual Petrol Rear Wheel Drive';
for (const phrase of [
  'automatic temperature control',
  'electric side steps',
  'electric window motor',
  'automatic climate control',
  'electric running boards',
  'electric tailgate',
  'manual central locking',
])
  void test(`relations: component head owns ${phrase}`, async () => {
    const m = make(),
      base = await m.match(identity),
      actual = await m.match(`${identity}; fitted with ${phrase}.`);
    assert.equal(actual.vehicleId, base.vehicleId);
    assert.deepEqual(actual.candidateIds, base.candidateIds);
  });
for (const phrase of [
  'automatic transmission',
  'electric drive motor',
  'electric traction motor',
  'automatic gearbox',
  'hybrid engine',
])
  void test(`relations: real powertrain ${phrase} remains conflicting`, async () => {
    assert.equal((await make().match(`${identity}; ${phrase}.`)).vehicleId, null);
  });
for (const event of [
  'We are switching to a hybrid car',
  'I am upgrading to a four wheel drive',
  'Reason for sale: change to electric vehicle',
  'I purchased a new Toyota RAV4 Cruiser hybrid',
  'We bought another Toyota Camry SL hybrid',
])
  void test(`relations: separate ownership event ${event}`, async () => {
    const m = make(),
      base = await m.match(identity),
      actual = await m.match(`${identity}. ${event}.`);
    assert.equal(actual.vehicleId, base.vehicleId);
    assert.deepEqual(actual.candidateIds, base.candidateIds);
  });
for (const input of [
  `I bought this ${identity} recently, now selling it.`,
  `I purchased a new ${identity}.`,
])
  void test(`relations: purchase does not erase the only target: ${input}`, async () => {
    const m = make();
    assert.equal((await m.match(input)).vehicleId, (await m.match(identity)).vehicleId);
  });
void test('relations: conversions and a finite target reset remain actual assertions', async () => {
  const m = make();
  for (const input of [
    `${identity}. We converted this car to electric.`,
    `${identity}. We are switching to a hybrid car, but this car is automatic.`,
  ])
    assert.equal((await m.match(input)).vehicleId, null, input);
});
void test('relations: affirmative advertising versus a genuine wanted advertisement', async () => {
  const m = make(),
    base = await m.match(identity);
  assert.equal(
    (await m.match(`Looking for a stylish ride? Look no further than this ${identity}.`)).vehicleId,
    base.vehicleId,
  );
  assert.equal((await m.match(`Wanted: ${identity}`)).vehicleId, null);
  assert.equal((await m.match(`Looking for a ${identity}`)).vehicleId, null);
  assert.equal(
    (await m.match(`Look no further than this Toyota 86 GT; not manual.`)).candidateIds.length,
    1,
  );
});
void test('relations: punctuation protects a standalone gearbox before equipment', async () => {
  const m = make();
  for (const text of [
    'Toyota 86 GT Manual, electric side steps.',
    'Toyota 86 GT Manual with automatic temperature control.',
  ])
    assert.equal((await m.match(text)).vehicleId, (await m.match('Toyota 86 GT Manual')).vehicleId);
});
void test('relations: correction beats prior target and purchase scope ends at clause reset', async () => {
  const m = make();
  assert.equal(
    (
      await m.match(
        'Toyota 86 GT Manual. Correction: Toyota 86 GT Automatic. We bought a new RAV4.',
      )
    ).vehicleId,
    (await m.match('Toyota 86 GT Automatic')).vehicleId,
  );
});
void test('relations: annotation boundaries are observable and require independent identity', () => {
  assert.deepEqual(entityRelations('we purchased a new rav4', []), []);
  assert.equal(presentationEnd('look no further than this '), 26);
  assert.ok(required(equipmentRelations('manual, with electric side steps')[0]).start > 6);
});

for (const object of ['engine: diesel', 'transmission: automatic', 'automatic transmission'])
  void test(`relations: purchased target component ${object} is not another vehicle`, async () => {
    assert.equal((await make().match(`${identity}. I purchased a new ${object}.`)).vehicleId, null);
  });
void test('relations: changing the gearbox remains a target assertion', async () => {
  assert.equal(
    (await make().match(`${identity}. We are switching to automatic transmission.`)).vehicleId,
    null,
  );
});
void test('relations: verified model metadata adds no missing drivetrain and rejects mismatches', async () => {
  const m = make();
  assert.deepEqual(
    (await m.match('Toyota Kluger GSU50R Black Edition')).candidateIds,
    (await m.match('Toyota Kluger Black Edition')).candidateIds,
  );
  assert.equal((await m.match('Toyota 86 GSU50R GT Manual')).vehicleId, null);
  assert.equal((await m.match('Toyota Kluger XYZ50R Black Edition')).vehicleId, null);
});
