/** Validate configuration before opening a socket or database connection. */
export function parsePort(value: string | undefined, fallback: number, minimum = 1): number {
  if (value !== undefined && !/^[0-9]+$/.test(value)) throw new Error('Port must be an integer.');
  const port = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(port) || port < minimum || port > 65535)
    throw new Error('Port is outside the permitted range.');
  return port;
}
export function databaseConfig(env: NodeJS.ProcessEnv) {
  const limits = { max: 8, statement_timeout: 5000, connectionTimeoutMillis: 5000 };
  if (env.DATABASE_URL) {
    let url: URL;
    try {
      url = new URL(env.DATABASE_URL);
    } catch {
      throw new Error('DATABASE_URL is invalid.');
    }
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      url.pathname.length < 2
    )
      throw new Error('DATABASE_URL must identify a PostgreSQL database.');
    return { ...limits, connectionString: env.DATABASE_URL };
  }
  const host = env.PGHOST ?? '127.0.0.1',
    database = env.PGDATABASE ?? 'autograb';
  if (!host.trim() || !database.trim())
    throw new Error('PostgreSQL host and database must be nonempty.');
  return { ...limits, host, port: parsePort(env.PGPORT, 5432), database };
}
