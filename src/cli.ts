import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { CatalogueStore, pool } from './db.js';
import { createMatcher } from './matcher-factory.js';

const db = pool();
try {
  const filename = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'supplied/inputs.txt';
  const store = new CatalogueStore(db);
  const vehicles = await store.load();
  const counts = (ids: string[]) => store.counts(ids);
  const matcher = createMatcher(vehicles, counts);
  const lines = createInterface({ input: createReadStream(filename), crlfDelay: Infinity });
  let line = 0;
  for await (const input of lines) {
    line++;
    if (!input.trim()) continue;
    const start = performance.now();
    try {
      const result = await matcher.match(input);
      console.log(
        JSON.stringify({ input, vehicleId: result.vehicleId, confidence: result.confidence }),
      );
      if (process.argv.includes('--diagnostics'))
        console.error(
          JSON.stringify({
            line,
            candidateCount: result.candidateIds.length,
            needsSemanticReview: result.needsSemanticReview,
            durationMs: performance.now() - start,
            notes: result.notes,
          }),
        );
    } catch {
      // Never disguise a failed computation as a confident absence.
      console.log(JSON.stringify({ input, error: 'MATCH_FAILED' }));
      console.error(JSON.stringify({ line, code: 'MATCH_FAILED' }));
      process.exitCode = 1;
    }
  }
} catch {
  console.error(
    JSON.stringify({
      code: 'STARTUP_OR_INPUT_FAILED',
      message: 'Check database setup and input file.',
    }),
  );
  process.exitCode = 1;
} finally {
  await db.end();
}
