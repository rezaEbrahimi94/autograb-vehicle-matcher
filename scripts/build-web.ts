import { build } from 'esbuild';
await build({
  entryPoints: ['web/app.ts'],
  outfile: 'web/app.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  logLevel: 'warning',
});
