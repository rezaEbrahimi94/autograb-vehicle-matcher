import { required } from './invariant.js';
import { parseCatalogueFixture, json } from './contracts.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VehicleMatcher } from './vehicle-matcher.js';
const { vehicles, counts } = parseCatalogueFixture(
  json(readFileSync(new URL('../test-data/catalogue.json', import.meta.url), 'utf8')),
);
const make = () =>
  new VehicleMatcher(vehicles, async (ids) => new Map(ids.map((id) => [id, counts[id] ?? 0])), {
    cacheSize: 0,
  });
for (const suffix of [
  'AWD 7 Seat Wagon',
  '7 seats AWD',
  'AWD with electric seats',
  'Petrol Hybrid CVT Automatic eFour AWD',
  'with manual seat adjustment',
])
  void test(`composition: explicit absent hybrid powertrain survives ${suffix}`, async () => {
    assert.equal((await make().match(`Toyota Kluger GX Hybrid ${suffix}`)).vehicleId, null);
  });
for (const suffix of [
  'electric seat adjustment',
  'manual seats',
  'automatic headlights',
  'manual window regulators',
])
  void test(`composition: true component modifiers remain equipment: ${suffix}`, async () => {
    const m = make();
    assert.deepEqual(
      (await m.match(`Toyota Kluger GX Automatic AWD with ${suffix}`)).candidateIds,
      (await m.match('Toyota Kluger GX Automatic AWD')).candidateIds,
    );
  });
for (const reason of [
  'as I no longer need a large car',
  'because we are moving away',
  'although I enjoy driving it',
  'while we prepare to relocate',
])
  void test(`composition: package phrase ends before reason ${reason}`, async () => {
    const m = make();
    assert.deepEqual(
      (await m.match(`Volkswagen Tiguan Allspace Highline with the R-Line package ${reason}.`))
        .candidateIds,
      (await m.match('Volkswagen Tiguan Allspace Highline')).candidateIds,
    );
  });
void test('composition: actual conflicting R-Line badge and unsupported engine code remain constraints', async () => {
  const m = make();
  for (const input of [
    'Volkswagen Tiguan Highline. Actual trim: R-Line.',
    'Volkswagen Golf 103TSI Highline engine tune',
    'Volkswagen Amarok TDI590 Core engine tune',
    'Volkswagen Amarok TDI550 Core Premium Edition engine tune',
  ])
    assert.equal((await m.match(input)).vehicleId, null, input);
});
for (const nounPhrase of [
  'CRD engine and transmission tune',
  'with custom gearbox remap',
  'with PWR transmission cooler',
  'CRD engine & transmission tuning',
])
  void test(`composition: technical modifier belongs to ${nounPhrase}`, async () => {
    const m = make();
    assert.deepEqual(
      (await m.match(`Amarok Core TDI550 MY19 ${nounPhrase}`)).candidateIds,
      (await m.match('Amarok Core TDI550')).candidateIds,
    );
  });
void test('composition: technical descriptions never erase explicit fuel or gearbox assertions', async () => {
  const m = make();
  for (const input of [
    'Toyota 86 GT Manual Petrol Hybrid engine tune',
    'Toyota 86 GT Manual automatic gearbox remap',
    'Amarok Core TDI550 petrol engine tune',
    'Amarok Core TDI550 grade: Premium engine tune',
  ])
    assert.equal((await m.match(input)).vehicleId, null, input);
});
void test('composition: exact Package grades and explicit negation stay meaningful', async () => {
  const m = make();
  assert.equal(
    (await m.match('Toyota Kluger GX not hybrid AWD 7 Seat')).vehicleId,
    (await m.match('Toyota Kluger GX AWD')).vehicleId,
  );
  assert.equal(
    (await m.match('Toyota 86 GT Manual, not automatic, with electric seats')).vehicleId,
    (await m.match('Toyota 86 GT Manual')).vehicleId,
  );
});

for (const modifier of ['Life', 'GTI', 'TSI', 'TDI'])
  void test(`composition: a possible grade or engine family ${modifier} is not silently consumed`, async () => {
    assert.equal(
      (await make().match(`Volkswagen Golf 110TSI Comfortline ${modifier} engine tune`)).vehicleId,
      null,
    );
  });
for (const equipment of [
  'electric 8-way seats',
  '8 way electric seats',
  'automatic 3-zone climate control',
])
  void test(`composition: numeric equipment functions ${equipment} are not seating capacities`, async () => {
    const m = make();
    assert.deepEqual(
      (await m.match(`Toyota 86 GT Manual with ${equipment}`)).candidateIds,
      (await m.match('Toyota 86 GT Manual')).candidateIds,
    );
  });
void test('composition: a catalogue grade ending Package stays a grade before a reason clause', async () => {
  const custom = [
    { ...required(vehicles[0]), id: 'base', make: 'Example', model: 'Roadster', badge: 'Prime' },
    {
      ...required(vehicles[0]),
      id: 'package',
      make: 'Example',
      model: 'Roadster',
      badge: 'Prime Sport Package',
    },
  ];
  const m = new VehicleMatcher(custom, async (ids) => new Map(ids.map((id) => [id, 0])), {});
  assert.equal(
    (await m.match('Example Roadster Prime Sport Package as I am relocating')).vehicleId,
    'package',
  );
});
