import pg from 'pg';
import { createHash } from 'node:crypto';
import { databaseConfig } from './config.js';
import { parseVehicle, parseCountRow, record, type Vehicle } from './contracts.js';
export type { Vehicle } from './contracts.js';
export function pool() {
  return new pg.Pool(databaseConfig(process.env));
}
export class CatalogueStore {
  countQueries = 0;
  constructor(
    readonly db: pg.Pool,
    readonly schema = 'autograb',
  ) {
    if (!/^autograb(?:_bench_[0-9]+)?$/.test(schema)) throw new Error('Invalid test schema');
  }
  async load(): Promise<Vehicle[]> {
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT vi.* FROM ${this.schema}.vehicle AS vi ORDER BY vi.id`,
    );
    return result.rows.map(parseVehicle);
  }
  async counts(ids: string[]): Promise<Map<string, number>> {
    this.countQueries++;
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT vi.id, COUNT(li.vehicle_id)::text AS count
       FROM ${this.schema}.vehicle AS vi LEFT JOIN ${this.schema}.listing AS li ON li.vehicle_id = vi.id
       WHERE vi.id = ANY($1::text[]) GROUP BY vi.id`,
      [ids],
    );
    return new Map(
      result.rows.map((value) => {
        const row = parseCountRow(value);
        return [row.id, row.count];
      }),
    );
  }
  async fingerprint(): Promise<{ catalogueHash: string; listingCountsHash: string }> {
    // A single statement takes one database snapshot of the matching-relevant data.
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT row_to_json(vi) AS vehicle, COUNT(li.vehicle_id)::text AS count
       FROM ${this.schema}.vehicle AS vi LEFT JOIN ${this.schema}.listing AS li ON li.vehicle_id = vi.id
       GROUP BY vi.id ORDER BY vi.id`,
    );
    const hash = (value: unknown) =>
      createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const rows = result.rows.map((value) => {
      const row = record(value);
      const vehicle = parseVehicle(row.vehicle);
      return {
        vehicle,
        count: parseCountRow({ id: vehicle.id, count: row.count }).count,
      };
    });
    return {
      catalogueHash: hash(rows.map((r) => r.vehicle)),
      listingCountsHash: hash(rows.map((r) => [r.vehicle.id, String(r.count)])),
    };
  }
}
