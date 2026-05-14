import * as esbuild from 'esbuild';
import { mkdirSync, cpSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const dist = join(root, 'dist');
const watch = process.argv.includes('--watch');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => d !== '@plan-review/core');

await esbuild.build({
  entryPoints: [join(root, 'src/index.ts')],
  bundle: true,
  outfile: join(dist, 'index.js'),
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external,
  banner: { js: '#!/usr/bin/env node' },
  sourcemap: true,
  minify: !watch,
});

const browserSrc = join(root, '../browser-app/dist');
if (!existsSync(browserSrc)) {
  console.error('[build] browser-app dist missing — build it first.');
  process.exit(1);
}
cpSync(browserSrc, join(dist, 'browser'), { recursive: true });

console.error('[build] cli build complete');
