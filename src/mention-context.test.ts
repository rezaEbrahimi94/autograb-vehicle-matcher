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
const base = 'Toyota Camry SL Hybrid';
for (const agency of [
  'service history through Toyota',
  'logbooks maintained by Volkswagen',
  'all servicing done at Toyota',
  'Toyota service history',
  'Volkswagen dealership',
])
  void test(`mentions: service agency ${agency} cannot supersede a complete sale vehicle`, async () => {
    const m = make();
    assert.deepEqual(
      (await m.match(`${base} one owner selling cause bought new car ${agency}`)).candidateIds,
      (await m.match(base)).candidateIds,
    );
  });
for (const changed of [
  'but actually selling Volkswagen Golf R',
  'Correction: Volkswagen Golf R',
  'now selling Volkswagen Golf R',
])
  void test(`mentions: service context does not erase actual target change ${changed}`, async () => {
    const m = make();
    assert.deepEqual(
      (await m.match(`${base} serviced at Toyota ${changed}`)).candidateIds,
      (await m.match('Volkswagen Golf R')).candidateIds,
    );
  });
void test('mentions: only vehicle and original same-clause fuel facts remain', async () => {
  const m = make();
  assert.deepEqual(
    (await m.match('Toyota Camry SL Hybrid service history')).candidateIds,
    (await m.match(base)).candidateIds,
  );
  assert.equal(
    (await m.match(`${base} selling, service history through Toyota, petrol engine`)).vehicleId,
    null,
  );
});
void test('mentions: prior history cannot override the explicitly sold vehicle', async () => {
  const m = make();
  assert.deepEqual(
    (await m.match(`My previous car was Toyota 86 GT. Now selling ${base} serviced by Volkswagen`))
      .candidateIds,
    (await m.match(base)).candidateIds,
  );
});
for (const shape of ['SUV', 'wagon', 'hatchback', 'sedan', 'coupe', 'utility', 'van'])
  void test(`mentions: body category ${shape} is metadata, not a trim`, async () => {
    const m = make();
    assert.deepEqual(
      (await m.match(`Volkswagen Tiguan ${shape} has central locking`)).candidateIds,
      (await m.match('Volkswagen Tiguan')).candidateIds,
    );
    assert.equal((await m.match(`Volkswagen Golf ${shape} GTD for sale`)).vehicleId, null);
  });
for (const measure of ['2 litre', '2.0 litres', '2.0L', '1968 cc', '2 liters'])
  void test(`mentions: unknown grade after ${measure} is retained as a constraint`, async () => {
    const m = make();
    assert.equal((await m.match(`Volkswagen Golf ${measure} GTD for sale`)).vehicleId, null);
    assert.deepEqual(
      (await m.match(`Volkswagen Golf ${measure} GTI Automatic`)).candidateIds,
      (await m.match('Volkswagen Golf GTI Automatic')).candidateIds,
    );
  });
void test('mentions: title descriptors do not weaken unsupported model/grade/powertrain claims', async () => {
  const m = make();
  for (const input of [
    'Toyota SUV Prado',
    'Volkswagen Golf SUV Life',
    'Volkswagen Golf 2 litre 103TSI Highline',
    'Toyota 86 coupe GT Manual automatic gearbox',
    'Volkswagen Golf R 2 litre Diesel',
    'Toyota Camry SL Hybrid 2.5L petrol engine',
  ])
    assert.equal((await m.match(input)).vehicleId, null, input);
});
void test('mentions: an independent target plus negated or correction identity is not an agency inference', async () => {
  const m = make();
  assert.deepEqual(
    (await m.match(`${base} service history through Volkswagen, not a Golf`)).candidateIds,
    (await m.match(base)).candidateIds,
  );
  assert.deepEqual(
    (await m.match(`${base} serviced at Toyota but actually selling Toyota 86 GT Manual`))
      .candidateIds,
    (await m.match('Toyota 86 GT Manual')).candidateIds,
  );
});

void test('mentions: a genuine new target model followed by service history stays a vehicle', async () => {
  const m = make();
  assert.deepEqual(
    (await m.match('Toyota 86 GT; actually selling Toyota Camry service history available'))
      .candidateIds,
    (await m.match('Toyota Camry')).candidateIds,
  );
});

void test('mentions: a new explicitly sold unsupported model cannot fall back to prior identity', async () => {
  assert.equal(
    (await make().match('Toyota 86 GT; actually selling Toyota Warranty')).vehicleId,
    null,
  );
});

for (const prefix of [
  '2 litre automatic',
  '2 litre front wheel drive',
  'SUV 2 litre Petrol Automatic',
  'automatic 1968 cc hatchback',
  'Petrol front wheel drive SUV',
])
  void test(`mentions: compatible title facts ${prefix} cannot hide an unknown grade`, async () => {
    const m = make();
    assert.equal((await m.match(`Volkswagen Golf ${prefix} GTD for sale`)).vehicleId, null);
    assert.equal((await m.match(`Volkswagen Golf GTD ${prefix} for sale`)).vehicleId, null);
    assert.ok((await m.match(`Volkswagen Golf ${prefix} GTI for sale`)).vehicleId);
  });
void test('mentions: title-prefix traversal stops at genuine equipment prose', async () => {
  const m = make();
  assert.deepEqual(
    (await m.match('Volkswagen Golf automatic with GTD wheels')).candidateIds,
    (await m.match('Volkswagen Golf automatic')).candidateIds,
  );
});

void test('mentions: door counts are typed descriptors and a preceding grade closes the title prefix', async () => {
  const m = make();
  assert.equal((await m.match('Volkswagen Golf 5DR Automatic GTD')).vehicleId, null);
  assert.deepEqual(
    (await m.match('Toyota RAV4 2WD PET 5DR CVT GX')).candidateIds,
    (await m.match('Toyota RAV4 GX Petrol Automatic 2WD')).candidateIds,
  );
  assert.deepEqual(
    (await m.match('GT 86 Automatic Low mileage')).candidateIds,
    (await m.match('Toyota 86 GT Automatic')).candidateIds,
  );
});
