import { required as invariant } from '../src/invariant.js';
import { json, parseCountRow, type StatusResponse } from '../src/contracts.js';
import { parseFixtures, VEHICLE_FIELDS } from '../src/data-contracts.js';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { CatalogueStore, pool, type Vehicle } from '../src/db.js';
import { createMatcher, MATCHING_RUNTIME_FILES } from '../src/matcher-factory.js';

type Mode = 'matching';
const db = pool();
const modes: Mode[] = ['matching'];
const fixturesText = await readFile('test-data/fixtures.json', 'utf8');
const fixtures = parseFixtures(json(fixturesText));
type QualityRow = {
  name: string;
  input: string;
  split: string;
  category: string;
  correct: boolean | null;
  durationMs: number;
  candidateCount: number;
  selectedCandidateRecall: number | null;
  tiesComplete: boolean | null;
  vehicleId: string | null;
  confidence: number;
  needsSemanticReview: boolean;
  notes: string[];
};
type Quality = {
  mode: Mode;
  correct: number;
  total: number;
  accuracy: number;
  completeTieSets: number;
  evaluatedTieSets: number;
  incorrectAtConfidence8OrAbove: number;
  falseMatch: number;
  anchors: number;
  rows: QualityRow[];
};
type Performance = {
  label: string;
  mode: Mode;
  catalogueRows: number;
  cacheSize: number;
  concurrent: number;
  requests: number;
  buildMs: number;
  elapsedMs: number;
  p50Ms: number;
  p95Ms: number;
  requestsPerSecond: number;
  countQueries: number;
  analysisComputations: number;
  cacheHits: number;
  coalescedRequests: number;
  candidateVisits: number;
  paidModelCalls: number;
  paidModelCostUSD: number;
};
type Report = {
  createdAt: string;
  node: string;
  platform: string;
  matcherVersion: string;
  sourceHash: string;
  cpu: string | undefined;
  fixtureHash: string;
  caveats: string[];
  quality: Quality[];
  performance: Performance[];
  dataFingerprint?: StatusResponse['loadedFingerprint'];
  dataFingerprintAfter?: StatusResponse['loadedFingerprint'];
  catalogueRows?: number;
  listingRows?: number;
  scaleListingRows?: number;
  dataUnchangedDuringRun?: boolean;
};
const report: Report = {
  createdAt: new Date().toISOString(),
  node: process.version,
  platform: os.platform(),
  matcherVersion: createMatcher([], async () => new Map(), {}).version,
  sourceHash: createHash('sha256')
    .update((await Promise.all(MATCHING_RUNTIME_FILES.map((p) => readFile(p, 'utf8')))).join('\n'))
    .digest('hex'),
  cpu: os.cpus()[0]?.model,
  fixtureHash: createHash('sha256').update(fixturesText).digest('hex'),
  caveats: [
    'Visible authored development fixtures, not a blind holdout or production distribution.',
    'Local deterministic matching; no language-model inference.',
    'Model inference spend is zero; machine/database/training/engineering cost is not zero and not priced.',
    'Single-machine synthetic scale measurements are not a production capacity guarantee.',
  ],
  quality: [],
  performance: [],
};
const percentile = (v: number[], p: number) =>
  invariant([...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(v.length * p))]);
function build(data: Vehicle[], store: CatalogueStore, _mode: Mode, cacheSize: number) {
  const matcher = createMatcher(data, (ids) => store.counts(ids), { cacheSize });
  return { match: (input: string) => matcher.match(input), stats: matcher.stats };
}

try {
  const store = new CatalogueStore(db);
  const vehicles = await store.load();
  report.dataFingerprint = await store.fingerprint();
  const byId = new Map(vehicles.map((v) => [v.id, v]));
  const allCounts = await store.counts(vehicles.map((v) => v.id));
  report.catalogueRows = vehicles.length;
  report.listingRows = Number(
    parseCountRow({
      id: 'count',
      count: invariant(
        (await db.query<{ count: unknown }>('SELECT COUNT(*) FROM autograb.listing AS li')).rows[0],
      ).count,
    }).count,
  );
  for (const mode of modes) {
    const matcher = build(vehicles, store, mode, 0);
    const rows = [];
    for (const f of fixtures) {
      const started = performance.now();
      const result = await matcher.match(f.input);
      const durationMs = performance.now() - started;
      const actual = result.vehicleId ? byId.get(result.vehicleId) : null;
      let correct: boolean | null = Object.keys(f.expected).length ? true : null;
      if ('id' in f.expected && result.vehicleId !== f.expected.id) correct = false;
      for (const field of VEHICLE_FIELDS)
        if (f.expected[field] !== undefined && (!actual || actual[field] !== f.expected[field]))
          correct = false;
      let tiesComplete: boolean | null = null;
      if (f.equivalentIds) {
        const sorted = [...f.equivalentIds].sort(
          (a, b) => (allCounts.get(b) ?? 0) - (allCounts.get(a) ?? 0) || a.localeCompare(b),
        );
        if (result.vehicleId !== sorted[0]) correct = false;
        tiesComplete =
          f.equivalentIds.every((id) => result.candidateIds.includes(id)) &&
          result.candidateIds.every((id) => f.equivalentIds!.includes(id));
      }
      const required = f.equivalentIds ?? (f.expected.id ? [f.expected.id] : []);
      rows.push({
        name: f.name,
        input: f.input,
        split: f.split,
        category: f.category,
        correct,
        durationMs,
        candidateCount: result.candidateIds.length,
        selectedCandidateRecall: required.length
          ? required.filter((id) => result.candidateIds.includes(id)).length / required.length
          : null,
        tiesComplete,
        vehicleId: result.vehicleId,
        confidence: result.confidence,
        needsSemanticReview: result.needsSemanticReview,
        notes: result.notes,
      });
    }
    const scored = rows.filter((r) => r.correct !== null);
    report.quality.push({
      mode,
      correct: scored.filter((r) => r.correct).length,
      total: scored.length,
      accuracy: scored.filter((r) => r.correct).length / scored.length,
      completeTieSets: rows.filter((r) => r.tiesComplete === true).length,
      evaluatedTieSets: rows.filter((r) => r.tiesComplete !== null).length,
      incorrectAtConfidence8OrAbove: scored.filter((r) => !r.correct && r.confidence >= 8).length,
      falseMatch: scored.filter((r) => !r.correct && r.vehicleId !== null).length,
      anchors: rows.filter((r) => r.split === 'anchor' && r.correct).length,
      rows,
    });
  }
  async function measure(
    label: string,
    data: Vehicle[],
    countStore: CatalogueStore,
    mode: Mode,
    cacheSize: number,
    concurrent: number,
    texts: string[],
  ) {
    const queryStart = countStore.countQueries,
      start = performance.now();
    const matcher = build(data, countStore, mode, cacheSize);
    const buildMs = performance.now() - start;
    const timings: number[] = [];
    let cursor = 0;
    const clock = performance.now();
    await Promise.all(
      Array.from({ length: concurrent }, async () => {
        while (cursor < texts.length) {
          const text = invariant(texts[cursor++]);
          const t = performance.now();
          await matcher.match(text);
          timings.push(performance.now() - t);
        }
      }),
    );
    const elapsed = performance.now() - clock;
    report.performance.push({
      label,
      mode,
      catalogueRows: data.length,
      cacheSize,
      concurrent,
      requests: texts.length,
      buildMs,
      elapsedMs: elapsed,
      p50Ms: percentile(timings, 0.5),
      p95Ms: percentile(timings, 0.95),
      requestsPerSecond: (texts.length / elapsed) * 1000,
      countQueries: countStore.countQueries - queryStart,
      analysisComputations: matcher.stats.analysisComputations,
      cacheHits: matcher.stats.cacheHits,
      coalescedRequests: matcher.stats.coalescedRequests,
      candidateVisits: matcher.stats.candidateVisits,
      paidModelCalls: 0,
      paidModelCostUSD: 0,
    });
  }
  const sample = (await readFile('supplied/inputs.txt', 'utf8')).trim().split(/\r?\n/);
  for (const mode of modes) {
    await measure(
      'supplied-repeated-cache-disabled',
      vehicles,
      store,
      mode,
      0,
      1,
      Array.from({ length: 400 }, (_, i) => invariant(sample[i % sample.length])),
    );
    await measure(
      'supplied-repeated-cache-enabled',
      vehicles,
      store,
      mode,
      512,
      1,
      Array.from({ length: 400 }, (_, i) => invariant(sample[i % sample.length])),
    );
    await measure(
      'supplied-concurrent-duplicates',
      vehicles,
      store,
      mode,
      512,
      8,
      Array.from({ length: 400 }, (_, i) => invariant(sample[Math.floor(i / 8) % sample.length])),
    );
  }
  if (process.argv.includes('--scale')) {
    const schema = `autograb_bench_${process.pid}`;
    const ownerToken = process.env.AUTOGRAB_BENCH_TOKEN;
    if (ownerToken && !/^[a-f0-9-]{36}$/.test(ownerToken))
      throw new Error('Invalid benchmark ownership token');
    const setupClient = await db.connect();
    try {
      await setupClient.query('BEGIN');
      await setupClient.query(`CREATE SCHEMA ${schema}`);
      // Creation and ownership marker commit together; failed creation never claims an older schema.
      if (ownerToken) await setupClient.query(`COMMENT ON SCHEMA ${schema} IS '${ownerToken}'`);
      await setupClient.query('COMMIT');
    } catch (error) {
      await setupClient.query('ROLLBACK');
      throw error;
    } finally {
      setupClient.release();
    }
    try {
      await db.query(`CREATE TABLE ${schema}.vehicle (LIKE autograb.vehicle INCLUDING ALL)`);
      await db.query(`CREATE TABLE ${schema}.listing (LIKE autograb.listing INCLUDING ALL)`);
      await db.query(`INSERT INTO ${schema}.vehicle SELECT vi.* FROM autograb.vehicle AS vi`);
      // Artificial distinct models exercise catalogue growth, not real-world semantic diversity.
      await db.query(
        `INSERT INTO ${schema}.vehicle SELECT 'synthetic-'||n, 'SyntheticMake'||(n%50),
      'Model'||n, 'Variant'||(n%9), 'Automatic','Petrol','Front Wheel Drive'
      FROM generate_series(1,$1::integer) AS n`,
        [10000 - vehicles.length],
      );
      await db.query(`INSERT INTO ${schema}.listing SELECT 'listing-'||row_number() OVER (), vi.id, 'synthetic://local',10000,100
      FROM ${schema}.vehicle AS vi CROSS JOIN generate_series(1,10)`);
      await db.query(`ANALYZE ${schema}.vehicle`);
      await db.query(`ANALYZE ${schema}.listing`);
      const scaledStore = new CatalogueStore(db, schema);
      const scaled = await scaledStore.load();
      report.scaleListingRows = Number(
        parseCountRow({
          id: 'count',
          count: invariant(
            (await db.query<{ count: unknown }>(`SELECT COUNT(*) FROM ${schema}.listing AS li`))
              .rows[0],
          ).count,
        }).count,
      );
      const unique = scaled
        .filter((v) => v.id.startsWith('synthetic'))
        .slice(0, 500)
        .map(
          (v) =>
            `${v.make} ${v.model} ${v.badge} ${v.transmission_type} ${v.fuel_type} ${v.drive_type}`,
        );
      for (const mode of modes) {
        await measure('synthetic-10k-100k-unique', scaled, scaledStore, mode, 512, 1, unique);
        await measure(
          'synthetic-10k-100k-repeated',
          scaled,
          scaledStore,
          mode,
          512,
          8,
          Array.from({ length: 500 }, (_, i) =>
            invariant(sample[Math.floor(i / 8) % sample.length]),
          ),
        );
      }
    } finally {
      await db.query(`DROP SCHEMA ${schema} CASCADE`);
    }
  }
  report.dataFingerprintAfter = await store.fingerprint();
  report.dataUnchangedDuringRun =
    JSON.stringify(report.dataFingerprint) === JSON.stringify(report.dataFingerprintAfter);
  if (!report.dataUnchangedDuringRun)
    report.caveats.push(
      'Catalogue or listing counts changed during this run; rerun before interpreting comparisons.',
    );
  await mkdir('results', { recursive: true });
  await writeFile('results/benchmark.json', JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify(
      {
        quality: report.quality.map(({ rows: _rows, ...r }) => r),
        performance: report.performance,
        caveats: report.caveats,
      },
      null,
      2,
    ),
  );
} finally {
  await db.end();
}
