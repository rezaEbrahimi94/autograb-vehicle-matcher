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
for (const fuel of ['Hybrid Petrol', 'Petrol Hybrid', 'Petrol-Hybrid', 'Hybrid-Petrol'])
  void test(`facts: local compound fuel ${fuel} preserves its full meaning`, async () => {
    const m = make();
    assert.deepEqual(
      (await m.match(`Toyota RAV4 GX ${fuel} automatic 2WD`)).candidateIds,
      (await m.match('Toyota RAV4 GX Hybrid-Petrol automatic 2WD')).candidateIds,
    );
    assert.ok((await m.match(`Toyota RAV4 GX ${fuel} automatic 2WD`)).vehicleId);
  });
for (const claim of [
  'Petrol or Hybrid',
  'Petrol and Hybrid',
  'Hybrid Petrol. Diesel engine',
  'Hybrid, petrol engine',
  'Hybrid Diesel',
])
  void test(`facts: distinct or unsupported fuel claims remain constraints: ${claim}`, async () => {
    assert.equal((await make().match(`Toyota RAV4 GX ${claim} automatic`)).vehicleId, null);
  });
for (const phrase of [
  'Core V6 550',
  '550 V6 Core',
  'Core 550',
  '550 Core',
  'V6 Core 550',
  'Core Automatic 550',
])
  void test(`facts: catalogue-derived numeric grade ${phrase} is order-independent`, async () => {
    const m = make();
    assert.deepEqual(
      (await m.match(`Volkswagen Amarok ${phrase} 4WD`)).candidateIds,
      (await m.match('Volkswagen Amarok TDI550 Core 4WD')).candidateIds,
    );
  });
for (const quantity of ['$550', '550 km', '550 Nm', '550 dollars', '2021', '120,000 km'])
  void test(`facts: quantity ${quantity} is not grade evidence`, async () => {
    const m = make();
    assert.deepEqual(
      (await m.match(`Volkswagen Amarok Core ${quantity}`)).candidateIds,
      (await m.match('Volkswagen Amarok Core')).candidateIds,
    );
  });
void test('facts: absent numeric grade and explicit code conflicts cannot fall back to Core', async () => {
  const m = make();
  for (const input of ['Volkswagen Amarok Core V6 999', 'Volkswagen Amarok TDI420 Core V6 550'])
    assert.equal((await m.match(input)).vehicleId, null, input);
});
void test('facts: catalogue numeric model is not a grade and cylinder metadata infers no powertrain', async () => {
  const m = make();
  assert.deepEqual(
    (await m.match('Toyota 86 GT')).candidateIds,
    vehicles
      .filter((v) => v.model === '86' && v.badge === 'GT')
      .map((v) => v.id)
      .sort(),
  );
  assert.deepEqual(
    (await m.match('Volkswagen Amarok Core V6')).candidateIds,
    (await m.match('Volkswagen Amarok Core')).candidateIds,
  );
});
for (const item of [
  'Luxury Package: Sunroof | Leather',
  'Safety Package: Parking sensors | Cameras',
  'Comfort Package: heated seats',
])
  void test(`facts: explicit equipment contents do not invent an omitted grade: ${item}`, async () => {
    const m = make();
    assert.deepEqual(
      (await m.match(`Volkswagen Tiguan ${item}`)).candidateIds,
      (await m.match('Volkswagen Tiguan')).candidateIds,
    );
  });
void test('facts: unproved package, unsupported grade and scalar claims remain guarded', async () => {
  const m = make();
  for (const input of [
    'Volkswagen Tiguan Unknown Grade',
    'Volkswagen Tiguan Luxury Package',
    'Volkswagen Tiguan Luxury Package: Diesel engine',
    'Volkswagen Tiguan Life trim, Luxury Package: Sunroof',
  ])
    assert.equal((await m.match(input)).vehicleId, null, input);
});
void test('facts: a real named Package grade keeps its identity even with an equipment contents heading', async () => {
  const rows = [
    { ...required(vehicles[0]), id: 'base', make: 'Example', model: 'Roadster', badge: 'Prime' },
    {
      ...required(vehicles[0]),
      id: 'package',
      make: 'Example',
      model: 'Roadster',
      badge: 'Prime Sport Package',
    },
  ];
  const m = new VehicleMatcher(rows, async (ids) => new Map(ids.map((id) => [id, 0])), {});
  assert.equal(
    (await m.match('Example Roadster Prime Sport Package: Sunroof')).vehicleId,
    'package',
  );
});

void test('facts: ambiguous negative fuel lists retain exclusions rather than assume a compound', async () => {
  assert.equal((await make().match('Toyota Camry SL not petrol hybrid automatic')).vehicleId, null);
});
