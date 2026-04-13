import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const watch = process.argv.includes('--watch');

async function build() {
  const outJs = join(root, 'dist/browser/app.js');

  mkdirSync(join(root, 'dist/browser'), { recursive: true });

  await esbuild.build({
    entryPoints: [join(root, 'src/browser/index.tsx')],
    bundle: true,
    outfile: outJs,
    format: 'iife',
    jsx: 'automatic',
    jsxImportSource: 'preact',
    minify: !watch,
    sourcemap: watch,
    banner: { js: '/* bundled with preact */' },
  });

  const js = readFileSync(outJs, 'utf-8');
  const css = readFileSync(join(root, 'src/browser/styles.css'), 'utf-8');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Plan Review</title>
<style>${css}</style>
</head>
<body>
<div id="app"></div>
<script>${js}</script>
</body>
</html>`;

  writeFileSync(join(root, 'dist/browser/index.html'), html);
  console.error('Browser build complete: dist/browser/index.html');
}

if (watch) {
  const ctx = await esbuild.context({
    entryPoints: [join(root, 'src/browser/index.tsx')],
    bundle: true,
    outfile: join(root, 'dist/browser/app.js'),
    format: 'iife',
    jsx: 'automatic',
    jsxImportSource: 'preact',
  });
  await ctx.watch();
  console.error('Watching for changes...');
} else {
  await build();
}
