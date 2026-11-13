import { json } from '../src/contracts.js';
import { parsePublicListings } from '../src/data-contracts.js';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { CatalogueStore, pool } from '../src/db.js';
import { createMatcher } from '../src/matcher-factory.js';
const dataset = parsePublicListings(json(await readFile('test-data/public-listings.json', 'utf8')));
const db = pool();
try {
  const store = new CatalogueStore(db),
    vehicles = await store.load(),
    matcher = createMatcher(vehicles, (ids) => store.counts(ids), { cacheSize: 0 });
  const rows = [];
  for (const row of dataset.cases) {
    const result = await matcher.match(row.input);
    const idCorrect = result.vehicleId === row.expected;
    const strict =
      idCorrect &&
      (row.expected === null ||
        JSON.stringify(result.candidateIds) === JSON.stringify(row.expectedCandidates));
    rows.push({
      ...row,
      actual: result.vehicleId,
      candidateIds: result.candidateIds,
      confidence: result.confidence,
      idCorrect,
      strict,
    });
  }
  const report = {
    dataset: dataset.description,
    dataFingerprint: await store.fingerprint(),
    summary: {
      cases: rows.length,
      selectedCorrect: rows.filter((r) => r.idCorrect).length,
      strictCorrect: rows.filter((r) => r.strict).length,
      wrongSelections: rows.filter((r) => !r.idCorrect && r.actual !== null).length,
      falseAbsences: rows.filter((r) => r.actual === null && r.expected !== null).length,
    },
    rows,
  };
  await mkdir('results', { recursive: true });
  await writeFile('results/evaluation.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.summary, null, 2));
} finally {
  await db.end();
}
