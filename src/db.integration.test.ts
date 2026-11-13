import test from 'node:test';
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import type pg from 'pg';
import { CatalogueStore, pool } from './db.js';
// Exercise the runtime default; older matching methods retain their unit tests.
import { createMatcher } from './matcher-factory.js';

// Opt in so ordinary unit tests remain runnable without PostgreSQL. This suite
// deliberately uses real SQL; a missing database is a failure when enabled.
const enabled = process.env.AUTOGRAB_INTEGRATION === '1';
const integration = (name: string, run: () => Promise<void>) =>
  void test(
    name,
    {
      skip: enabled
        ? false
        : 'Run npm run test:integration with the documented PostgreSQL connection.',
      timeout: 30_000,
    },
    run,
  );

async function isolatedDatabase(
  run: (db: pg.Pool, store: CatalogueStore, schema: string) => Promise<void>,
): Promise<void> {
  const schema = `autograb_bench_${Date.now()}${process.pid}${randomInt(1_000_000).toString().padStart(6, '0')}`;
  // Only the internally generated numeric test schema is interpolated. Vehicle
  // values and input-derived IDs are always query parameters.
  assert.match(schema, /^autograb_bench_[0-9]+$/);
  assert.ok(schema.length < 63);
  const db = pool();
  let ownsSchema = false;
  try {
    await db.query(`CREATE SCHEMA ${schema}`);
    ownsSchema = true;
    await db.query(`CREATE TABLE ${schema}.vehicle (
      id TEXT NOT NULL PRIMARY KEY, make TEXT NOT NULL, model TEXT NOT NULL,
      badge TEXT NOT NULL, transmission_type TEXT NOT NULL,
      fuel_type TEXT NOT NULL, drive_type TEXT NOT NULL
    )`);
    await db.query(`CREATE TABLE ${schema}.listing (
      id TEXT NOT NULL PRIMARY KEY,
      vehicle_id TEXT NOT NULL REFERENCES ${schema}.vehicle(id),
      url TEXT NOT NULL, price INT NOT NULL, kms INT NOT NULL
    )`);
    await db.query(`CREATE INDEX listing_vehicle_id_idx ON ${schema}.listing(vehicle_id)`);
    await db.query(`INSERT INTO ${schema}.vehicle
      (id,make,model,badge,transmission_type,fuel_type,drive_type)
      VALUES
      ('auto-a','Toyota','86','GT','Automatic','Petrol','Rear Wheel Drive'),
      ('manual-b','Toyota','86','GT','Manual','Petrol','Rear Wheel Drive'),
      ('golf-r','Volkswagen','Golf','R','Automatic','Petrol','Four Wheel Drive'),
      ('camry-h','Toyota','Camry','SL','Automatic','Hybrid-Petrol','Front Wheel Drive')`);
    await db.query(`INSERT INTO ${schema}.listing (id,vehicle_id,url,price,kms)
      SELECT 'auto-'||n,'auto-a','synthetic://integration',10000,100 FROM generate_series(1,3) AS n`);
    await db.query(`INSERT INTO ${schema}.listing (id,vehicle_id,url,price,kms)
      SELECT 'golf-'||n,'golf-r','synthetic://integration',10000,100 FROM generate_series(1,40) AS n`);
    await run(db, new CatalogueStore(db, schema), schema);
  } finally {
    try {
      // Never clean up a schema unless this invocation successfully created it.
      // In particular the original "autograb" schema cannot reach this query.
      if (ownsSchema) await db.query(`DROP SCHEMA ${schema} CASCADE`);
    } finally {
      await db.end();
    }
  }
}

function sqlCode(code: string): (error: unknown) => boolean {
  return (error) =>
    typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

integration(
  'PostgreSQL: an exact zero-listing variant beats popular incompatible vehicles',
  async () => {
    await isolatedDatabase(async (_db, store) => {
      const counts = await store.counts(['auto-a', 'manual-b', 'golf-r']);
      assert.deepEqual([...counts.entries()].sort(), [
        ['auto-a', 3],
        ['golf-r', 40],
        ['manual-b', 0],
      ]);
      const matcher = createMatcher(await store.load(), (ids) => store.counts(ids), {});
      const result = await matcher.match('Toyota 86 GT Manual Petrol Rear Wheel Drive');
      assert.equal(result.vehicleId, 'manual-b');
      assert.deepEqual(result.candidateIds, ['manual-b']);
    });
  },
);

integration(
  'PostgreSQL: changed listing counts affect a cached semantic tie immediately',
  async () => {
    await isolatedDatabase(async (db, store, schema) => {
      const matcher = createMatcher(await store.load(), (ids) => store.counts(ids), {});
      const first = await matcher.match('Toyota 86 GT');
      assert.equal(first.vehicleId, 'auto-a');
      assert.deepEqual(first.candidateIds, ['auto-a', 'manual-b']);
      await db.query(
        `INSERT INTO ${schema}.listing (id,vehicle_id,url,price,kms)
      SELECT 'manual-'||n,$1,'synthetic://integration',10000,100 FROM generate_series(1,4) AS n`,
        ['manual-b'],
      );
      const second = await matcher.match('Toyota 86 GT');
      assert.equal(second.vehicleId, 'manual-b');
      assert.deepEqual(second.candidateIds, first.candidateIds);
      assert.equal(matcher.stats.analysisComputations, 1);
      assert.equal(matcher.stats.cacheHits, 1);
      assert.equal(store.countQueries, 2);
      assert.equal(
        second.confidence,
        first.confidence,
        'Popularity changes selection, not descriptive certainty.',
      );
    });
  },
);

integration(
  'PostgreSQL: a real SQL failure rejects instead of becoming a no-match and recovery works',
  async () => {
    await isolatedDatabase(async (db, store, schema) => {
      const matcher = createMatcher(await store.load(), (ids) => store.counts(ids), {});
      assert.equal((await matcher.match('Toyota 86 GT')).vehicleId, 'auto-a');
      await db.query(`ALTER TABLE ${schema}.listing RENAME TO listing_unavailable`);
      try {
        await assert.rejects(matcher.match('Toyota 86 GT'), sqlCode('42P01'));
      } finally {
        await db.query(`ALTER TABLE ${schema}.listing_unavailable RENAME TO listing`);
      }
      assert.equal((await matcher.match('Toyota 86 GT')).vehicleId, 'auto-a');
      assert.equal(store.countQueries, 3);
      assert.equal(matcher.stats.analysisComputations, 1);
    });
  },
);

integration(
  'PostgreSQL: a new catalogue snapshot invalidates a previous cached absence',
  async () => {
    await isolatedDatabase(async (db, store, schema) => {
      const description = 'Toyota Corolla Ascent Sport Automatic';
      const oldMatcher = createMatcher(await store.load(), (ids) => store.counts(ids), {});
      assert.equal((await oldMatcher.match(description)).vehicleId, null);
      await db.query(
        `INSERT INTO ${schema}.vehicle
      (id,make,model,badge,transmission_type,fuel_type,drive_type)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          'corolla-new',
          'Toyota',
          'Corolla',
          'Ascent Sport',
          'Automatic',
          'Petrol',
          'Front Wheel Drive',
        ],
      );
      const newMatcher = createMatcher(await store.load(), (ids) => store.counts(ids), {});
      assert.equal((await newMatcher.match(description)).vehicleId, 'corolla-new');
      assert.equal(
        (await oldMatcher.match(description)).vehicleId,
        null,
        'Old matcher deliberately retains its immutable snapshot.',
      );
      assert.equal((await store.counts(['corolla-new'])).get('corolla-new'), 0);
    });
  },
);

integration(
  'PostgreSQL: concurrent identical descriptions coalesce the real count query',
  async () => {
    await isolatedDatabase(async (_db, store) => {
      const matcher = createMatcher(await store.load(), (ids) => store.counts(ids), {});
      const results = await Promise.all(
        Array.from({ length: 12 }, () => matcher.match('Toyota 86 GT')),
      );
      assert.ok(results.every((result) => result.vehicleId === 'auto-a'));
      assert.equal(store.countQueries, 1);
      assert.equal(matcher.stats.coalescedRequests, 11);
      await matcher.match('Toyota 86 GT');
      assert.equal(store.countQueries, 2, 'A later request must fetch fresh counts.');
    });
  },
);

integration(
  'PostgreSQL: hostile-looking IDs remain data and constraints reject invalid rows',
  async () => {
    await isolatedDatabase(async (db, store, schema) => {
      const hostileId = `manual-b'); DROP TABLE ${schema}.vehicle; --`;
      assert.equal((await store.counts([hostileId])).size, 0);
      assert.equal((await store.load()).length, 4);
      await assert.rejects(
        db.query(
          `INSERT INTO ${schema}.listing (id,vehicle_id,url,price,kms)
      VALUES ($1,$2,$3,$4,$5)`,
          ['orphan', 'missing-vehicle', 'synthetic://integration', 10000, 100],
        ),
        sqlCode('23503'),
      );
      await assert.rejects(
        db.query(`INSERT INTO ${schema}.vehicle SELECT * FROM ${schema}.vehicle WHERE id=$1`, [
          'auto-a',
        ]),
        sqlCode('23505'),
      );
      assert.equal((await store.load()).length, 4);
    });
  },
);
