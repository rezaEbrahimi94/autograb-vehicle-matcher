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
for (const tail of ['Limited', 'Limited Coupe', 'Limited Edition', 'Premium Grade', 'Special Trim'])
  void test(`nominals: unsupported grade extension ${tail} cannot collapse to GT`, async () => {
    assert.equal((await make().match(`Toyota 86 GT ${tail}`)).vehicleId, null);
  });
for (const tail of [
  'limited time offer',
  'limited kilometres',
  'limited warranty',
  'limited slip differential',
  'with heated seats and 17 inch wheels, plus other top model features in velocity orange',
  'with leather seats, plus additional equipment',
])
  void test(`nominals: ordinary noun heads preserve GT: ${tail}`, async () => {
    const m = make();
    assert.deepEqual(
      (await m.match(`Toyota 86 GT ${tail}`)).candidateIds,
      (await m.match('Toyota 86 GT')).candidateIds,
    );
  });
void test('nominals: actual Plus and Apollo Blue named grades remain literal', async () => {
  const m = make();
  for (const [model, badge] of [
    ['Amarok', 'TDI420 Core Plus'],
    ['86', 'GTS Apollo Blue'],
  ]) {
    const expected = vehicles
      .filter((v) => v.model === model && v.badge === badge)
      .map((v) => v.id)
      .sort();
    assert.ok(expected.length);
    assert.deepEqual((await m.match(`${model} ${badge}`)).candidateIds, expected);
  }
});
for (const packages of [
  'Luxury Package + Driver Assistance Package',
  'Luxury Package and Driver Assistance Package Excellent Condition',
  'Driver Assistance Package + Luxury Package',
  'Luxury Package, Driver Assistance Package with full service history',
])
  void test(`nominals: complete base anchors packages without a known badge removal: ${packages}`, async () => {
    const m = make();
    assert.deepEqual(
      (await m.match(`Volkswagen Tiguan 132TSI Comfortline ${packages}`)).candidateIds,
      (await m.match('Volkswagen Tiguan 132TSI Comfortline')).candidateIds,
    );
  });
void test('nominals: package scope retains scalar contradiction and independent unsupported grade', async () => {
  const m = make();
  for (const input of [
    'Volkswagen Tiguan 132TSI Comfortline Luxury Package + Driver Assistance Package, diesel engine',
    'Toyota 86 GT Manual, plus other features, automatic gearbox',
    'Volkswagen Golf 110TSI Highline Limited Coupe with Luxury Package',
  ])
    assert.equal((await m.match(input)).vehicleId, null, input);
});
void test('nominals: real named package grade is not an optional package', async () => {
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
  assert.equal((await m.match('Example Roadster Prime Sport Package')).vehicleId, 'package');
});

void test('nominals: punctuation is not required for additive plus after an independently complete base', async () => {
  const m = make();
  assert.deepEqual(
    (await m.match('Toyota 86 GTS plus other features')).candidateIds,
    (await m.match('Toyota 86 GTS')).candidateIds,
  );
  assert.equal(
    (await m.match('Toyota 86 GT Manual plus other features and automatic gearbox')).vehicleId,
    null,
  );
});
void test('nominals: parenthesized transmission metadata does not hide a grade suffix', async () => {
  assert.equal(
    (await make().match('Used 2020 Toyota 86 2.0 (A) GT Limited Coupe - Cars for sale')).vehicleId,
    null,
  );
});
void test('nominals: untyped coordinated names retain the unsupported designation guard', async () => {
  assert.equal(
    (await make().match('Toyota 86 GTS Dynamic Pack + Lunar Stone Manual')).vehicleId,
    null,
  );
});
