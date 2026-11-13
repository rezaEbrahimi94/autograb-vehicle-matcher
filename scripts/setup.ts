import { readFile } from 'node:fs/promises';
import { pool } from '../src/db.js';
const db = pool();
try {
  const original = await readFile('supplied/data.sql', 'utf8');
  // The supplied CREATE names the PK "it" while INSERT uses "id". Change only
  // the schema spelling in memory; preserve every supplied file and row.
  const corrected = original.replace(
    '  it TEXT NOT NULL PRIMARY KEY,',
    '  id TEXT NOT NULL PRIMARY KEY,',
  );
  if (corrected === original)
    throw new Error('Expected upstream schema typo absent; review setup before loading.');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE SCHEMA autograb');
    await client.query('SET LOCAL search_path TO autograb');
    await client.query(corrected);
    await client.query('CREATE INDEX listing_vehicle_id_idx ON listing (vehicle_id)');
    await client.query('ANALYZE vehicle');
    await client.query('ANALYZE listing');
    await client.query('COMMIT');
    console.log('Created isolated autograb schema. Existing schemas were not altered.');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
} finally {
  await db.end();
}
