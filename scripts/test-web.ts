import {
  json as parseJson,
  parseStatusResponse,
  parseMatchResponse,
  record,
} from '../src/contracts.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { request as httpRequest, type ClientRequest } from 'node:http';
import { fileURLToPath } from 'node:url';

// Uses the configured local PostgreSQL catalogue. Never starts a benchmark or calls AI.
const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.TEST_WEB_PORT ?? 4318);
const origin = `http://127.0.0.1:${port}`;
let child: ChildProcess;
let output = '';
type Reply = { status: number; headers: Record<string, unknown>; text: string; json: unknown };
function request(
  path: string,
  options: {
    method?: string;
    raw?: string;
    payload?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<Reply> {
  const raw =
    options.raw ?? (options.payload === undefined ? undefined : JSON.stringify(options.payload));
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: options.method ?? (raw === undefined ? 'GET' : 'POST'),
        headers: {
          'Content-Type': 'application/json',
          Origin: origin,
          ...(raw === undefined ? {} : { 'Content-Length': Buffer.byteLength(raw) }),
          ...options.headers,
        },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => {
          let json: unknown;
          try {
            json = parseJson(text);
          } catch {
            /* Static assets are not JSON. */
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json });
        });
      },
    );
    req.setTimeout(10_000, () => req.destroy(new Error('Request timed out')));
    req.once('error', reject);
    req.end(raw);
  });
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

before(async () => {
  assert.ok(
    Number.isInteger(port) && port >= 1024 && port <= 65535,
    'TEST_WEB_PORT must be a valid unprivileged port',
  );
  child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout!.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr!.on('data', (chunk: Buffer) => (output += chunk.toString()));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error('Local web server did not start; check PostgreSQL and port availability.'),
        ),
      10_000,
    );
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', () => {
      clearTimeout(timer);
      reject(new Error('Local web server exited before readiness.'));
    });
    child.stdout!.on('data', () => {
      if (output.includes(`Vehicle matcher: ${origin}`)) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
});
after(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill('SIGTERM');
    });
  }
});

void test('serves intended assets with security headers and current fingerprints', async () => {
  for (const path of ['/', '/app.js', '/styles.css']) {
    const r = await request(path);
    assert.equal(r.status, 200);
    assert.ok(r.text.length > 100);
    assert.ok(r.headers['content-security-policy']);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
  }
  const r = await request('/api/status');
  assert.equal(parseStatusResponse(r.json).status, 'ready');
  assert.equal(parseStatusResponse(r.json).restartRequired, false);
  assert.equal(
    parseStatusResponse(r.json).loadedSourceHash,
    parseStatusResponse(r.json).currentSourceHash,
  );
});
void test('matches actual database records with bounded confidence', async () => {
  const r = await request('/api/match', { payload: { input: 'Toyota 86 GT manual' } });
  assert.equal(r.status, 200);
  assert.equal(parseMatchResponse(r.json).vehicleId, '5027098813005824');
  assert.equal(parseMatchResponse(r.json).vehicle?.transmission_type, 'Manual');
  assert.ok(
    parseMatchResponse(r.json).confidence >= 0 && parseMatchResponse(r.json).confidence <= 10,
  );
});
void test('validates bodies, origins, hosts, routes, methods and byte limits', async () => {
  const cases: [string, Parameters<typeof request>[1], number][] = [
    ['/api/match', { raw: '{' }, 400],
    ['/api/match', { payload: {} }, 400],
    ['/api/match', { payload: { input: ' ' } }, 400],
    ['/api/match', { payload: { input: 'x'.repeat(10001) } }, 400],
    ['/api/match', { payload: { input: 'x', command: 'x' } }, 400],
    [
      '/api/match',
      { payload: { input: 'x' }, headers: { Origin: 'http://elsewhere.example' } },
      403,
    ],
    ['/api/match', { payload: { input: 'x' }, headers: { 'Content-Type': 'text/plain' } }, 415],
    ['/api/status', { headers: { Host: 'elsewhere.example' } }, 403],
    ['/api/match', { method: 'GET' }, 405],
    ['/src/db.ts', {}, 404],
    ['/../package.json', {}, 404],
    ['/api/match', { raw: 'x'.repeat(17000) }, 413],
  ];
  for (const [path, options, status] of cases)
    assert.equal((await request(path, options)).status, status, path);
});
void test('bounds concurrent request bodies', async () => {
  const held: ClientRequest[] = [],
    completions: Promise<number>[] = [];
  try {
    for (let i = 0; i < 4; i++)
      completions.push(
        new Promise((resolve, reject) => {
          const req = httpRequest(
            {
              hostname: '127.0.0.1',
              port,
              path: '/api/match',
              method: 'POST',
              headers: { Origin: origin, 'Content-Type': 'application/json' },
            },
            (res) => {
              res.resume();
              res.on('end', () => resolve(res.statusCode ?? 0));
            },
          );
          req.once('error', reject);
          req.write('{"input":"Toyota');
          held.push(req);
        }),
      );
    let active = 0;
    for (let i = 0; i < 30; i++) {
      active = parseStatusResponse((await request('/api/status')).json).activeRequests;
      if (active === 4) break;
      await pause(20);
    }
    assert.equal(active, 4);
    assert.equal((await request('/api/match', { payload: { input: 'Toyota 86' } })).status, 429);
    for (const req of held) req.end(' 86 GT manual"}');
    assert.deepEqual(await Promise.all(completions), [200, 200, 200, 200]);
  } finally {
    for (const req of held) req.destroy();
  }
});
void test('request logs omit descriptions and arbitrary paths', async () => {
  const marker = 'PRIVATE-DESCRIPTION-MUST-NOT-BE-LOGGED';
  const r = await request('/api/match', { payload: { input: marker } });
  await request('/private-path');
  await pause(20);
  assert.ok(!output.includes(marker) && !output.includes('/private-path'));
  const logs = output
    .split('\n')
    .filter((l) => l.startsWith('{'))
    .map((l) => record(parseJson(l)));
  const log = logs.find((l) => l.requestId === r.headers['x-request-id']);
  assert.ok(log);
  assert.equal(log.status, 200);
  assert.ok(typeof log.durationMs === 'number');
  assert.ok(log.durationMs >= 0);
});
