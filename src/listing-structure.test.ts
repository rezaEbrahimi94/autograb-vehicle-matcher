import { parseCatalogueFixture, json } from './contracts.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VehicleMatcher } from './vehicle-matcher.js';
import { structuredListingText } from './listing-structure.js';
const { vehicles, counts } = parseCatalogueFixture(
  json(readFileSync(new URL('../test-data/catalogue.json', import.meta.url), 'utf8')),
);
const make = () =>
  new VehicleMatcher(vehicles, async (ids) => new Map(ids.map((id) => [id, counts[id] ?? 0])), {
    cacheSize: 0,
  });
for (const delimiter of [' - ', ' — ', ' – ', ' • ', ' ✅ ', ' 🚘 '])
  void test(`structure: seller-list delimiter ${delimiter} separates an established title`, async () => {
    const m = make();
    assert.deepEqual(
      (
        await m.match(
          `Toyota GT 86${delimiter}One owner${delimiter}Low kilometres${delimiter}4x new tyres`,
        )
      ).candidateIds,
      (await m.match('Toyota 86 GT')).candidateIds,
    );
  });
for (const delimiter of [' - ', ' — ', ' – ', ' • '])
  void test(`structure: negation ends at ${delimiter} affirmative clause`, async () => {
    const m = make();
    assert.equal(
      (await m.match(`Toyota Camry Ascent Petrol NOT A HYBRID${delimiter}Pure Petrol engine`))
        .vehicleId,
      (await m.match('Toyota Camry Ascent Petrol')).vehicleId,
    );
    assert.equal(
      (await m.match(`Toyota Camry Ascent Petrol NOT A HYBRID${delimiter}not petrol`)).vehicleId,
      null,
    );
  });
for (const notation of ['4x2', '4 x 2', '4×2'])
  void test(`structure: ${notation} is two driven wheels, never universally FWD`, async () => {
    const m = make();
    assert.deepEqual(
      (await m.match(`Toyota RAV4 Cruiser Automatic ${notation}`)).candidateIds,
      (await m.match('Toyota RAV4 Cruiser Automatic Front Wheel Drive')).candidateIds,
    );
    assert.deepEqual(
      (await m.match(`Toyota 86 GT ${notation}`)).candidateIds,
      (await m.match('Toyota 86 GT Rear Wheel Drive')).candidateIds,
    );
    assert.equal((await m.match(`Volkswagen Golf R ${notation}`)).vehicleId, null);
  });
void test('structure: omitted drive and tyre quantities retain all compatible drives', async () => {
  const m = make();
  const base = await m.match('Toyota RAV4 Cruiser Automatic');
  assert.equal(base.candidateIds.length, 3);
  assert.deepEqual(
    (await m.match('Toyota RAV4 Cruiser Automatic;4x new tyres')).candidateIds,
    base.candidateIds,
  );
  assert.deepEqual(
    (await m.match('Toyota RAV4 Cruiser Automatic 4 x 4')).candidateIds,
    (await m.match('Toyota RAV4 Cruiser Automatic AWD')).candidateIds,
  );
});
for (const acquired of ['a 4WD', 'a hybrid car', 'a Toyota RAV4', 'another vehicle'])
  void test(`structure: indefinite acquisition ${acquired} belongs to another object`, async () => {
    const m = make();
    const base = await m.match('Toyota 86 GT Manual');
    assert.deepEqual(
      (await m.match(`Toyota 86 GT Manual. Have purchased ${acquired} therefore selling the 86.`))
        .candidateIds,
      base.candidateIds,
    );
  });
for (const acquired of [
  'a diesel engine',
  'an automatic gearbox',
  'a four wheel drive transmission',
])
  void test(`structure: acquired component ${acquired} remains a target specification`, async () => {
    assert.equal(
      (await make().match(`Toyota 86 GT Manual Petrol. I purchased ${acquired}.`)).vehicleId,
      null,
    );
  });
void test('structure: acquisition of the only vehicle is not discarded', async () => {
  const m = make();
  assert.deepEqual(
    (await m.match('I purchased a Toyota 86 GT Manual')).candidateIds,
    (await m.match('Toyota 86 GT Manual')).candidateIds,
  );
});
for (const equipment of [
  'electric roller shutter',
  'manual privacy blinds',
  'automatic curtains',
  'electric tonneau',
])
  void test(`structure: closure component ${equipment} owns its adjective`, async () => {
    const m = make();
    assert.deepEqual(
      (await m.match(`Toyota 86 GT Manual; ${equipment}`)).candidateIds,
      (await m.match('Toyota 86 GT Manual')).candidateIds,
    );
  });
void test('structure: explicit powertrain and unsupported title continuations remain constraints', async () => {
  const m = make();
  for (const input of [
    'Volkswagen Golf - Life',
    'Volkswagen Golf — Life',
    'Toyota 86 GT Manual - automatic transmission',
    'Toyota 86 GT Manual; electric drive motor',
  ])
    assert.equal((await m.match(input)).vehicleId, null, input);
});
void test('structure: in-word badges, fuel compounds, decimals and counts are unchanged', () => {
  const text = 'GT-S Hybrid-Diesel 2.5L 4x new tyres';
  assert.equal(structuredListingText(text), text);
});
