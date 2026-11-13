import { parsePort } from './config.js';
import {
  json as parseJson,
  parseMatchRequest,
  parseMatchResponse,
  parseStatusResponse,
  parseApiError,
} from './contracts.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CatalogueStore, pool } from './db.js';
import { createMatcher, MATCHING_RUNTIME_FILES } from './matcher-factory.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const port = parsePort(process.env.PORT, 4317, 1024);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('PORT must be an unprivileged TCP port.');
const host = '127.0.0.1',
  origin = `http://${host}:${port}`;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const sourceHash = async () =>
  sha(
    (await Promise.all(MATCHING_RUNTIME_FILES.map((p) => readFile(resolve(root, p), 'utf8')))).join(
      '\n',
    ),
  );
class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
async function body(req: IncomingMessage) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json')
    throw new RequestError(415, 'Use application/json.');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const raw of req) {
    const chunk: unknown = raw;
    if (!Buffer.isBuffer(chunk)) throw new RequestError(400, 'Invalid request body.');
    size += chunk.length;
    if (size > 16384) throw new RequestError(413, 'Request is too large.');
    chunks.push(chunk);
  }
  try {
    return parseMatchRequest(parseJson(Buffer.concat(chunks).toString('utf8')));
  } catch {
    throw new RequestError(400, 'Request must be a JSON object.');
  }
}
const json = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
};
const db = pool(),
  store = new CatalogueStore(db);
const vehicles = await store.load().catch(async () => {
  await db.end();
  throw new Error('Catalogue unavailable. Run setup before starting the app.');
});
const byId = new Map(vehicles.map((v) => [v.id, v]));
const matcher = createMatcher(vehicles, (ids) => store.counts(ids));
const loadedSourceHash = await sourceHash(),
  loadedFingerprint = await store.fingerprint();
let active = 0;
const assets: Record<string, { file: string; type: string }> = {
  '/': { file: 'web/index.html', type: 'text/html' },
  '/app.js': { file: 'web/app.js', type: 'text/javascript' },
  '/styles.css': { file: 'web/styles.css', type: 'text/css' },
};
async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const requestId = randomUUID(),
    start = performance.now();
  res.setHeader('X-Request-ID', requestId);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  res.once('finish', () =>
    console.log(
      JSON.stringify({
        event: 'request_completed',
        requestId,
        status: res.statusCode,
        durationMs: performance.now() - start,
      }),
    ),
  );
  try {
    if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`)
      throw new RequestError(403, 'Local host required.');
    const path = req.url ?? '';
    if (!assets[path] && !['/api/status', '/api/match'].includes(path))
      throw new RequestError(404, 'Not found.');
    const post = path === '/api/match';
    if (req.method !== (post ? 'POST' : 'GET')) {
      res.setHeader('Allow', post ? 'POST' : 'GET');
      throw new RequestError(405, 'Method not allowed.');
    }
    if (post && req.headers.origin !== `http://${req.headers.host}`)
      throw new RequestError(403, 'Same-origin request required.');
    if (assets[path]) {
      res.writeHead(200, { 'Content-Type': assets[path].type + '; charset=utf-8' });
      res.end(await readFile(resolve(root, assets[path].file)));
      return;
    }
    if (path === '/api/status') {
      const currentSourceHash = await sourceHash(),
        currentFingerprint = await store.fingerprint();
      json(
        res,
        200,
        parseStatusResponse({
          status: 'ready',
          catalogueRows: vehicles.length,
          loadedSourceHash,
          currentSourceHash,
          loadedFingerprint,
          currentFingerprint,
          activeRequests: active,
          restartRequired:
            loadedSourceHash !== currentSourceHash ||
            loadedFingerprint.catalogueHash !== currentFingerprint.catalogueHash,
        }),
      );
      return;
    }
    if (active >= 4) throw new RequestError(429, 'Busy; retry shortly.');
    active++;
    try {
      const value = await body(req);
      const result = await matcher.match(value.input);
      json(
        res,
        200,
        parseMatchResponse({
          input: value.input,
          ...result,
          vehicle: result.vehicleId ? byId.get(result.vehicleId) : null,
        }),
      );
    } finally {
      active--;
    }
  } catch (error) {
    json(
      res,
      error instanceof RequestError ? error.status : 500,
      parseApiError({
        error:
          error instanceof RequestError
            ? error.message
            : 'Matching unavailable. Check database availability and retry.',
      }),
    );
  }
}
const server = createServer((req, res) => {
  void handleRequest(req, res).catch(() => res.destroy());
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;
server.maxConnections = 64;
server.listen(port, host, () => console.log(`Vehicle matcher: ${origin}`));
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  server.close(
    () =>
      void db.end().then(
        () => process.exit(0),
        () => process.exit(1),
      ),
  );
  server.closeIdleConnections();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
