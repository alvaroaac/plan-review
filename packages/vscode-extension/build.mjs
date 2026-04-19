// packages/vscode-extension/build.js
import * as esbuild from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const watch = process.argv.includes('--watch');

mkdirSync(join(root, 'dist'), { recursive: true });
mkdirSync(join(root, 'media'), { recursive: true });

// 1) Build extension host (CommonJS)
await esbuild.build({
  entryPoints: [join(root, 'src/extension.ts')],
  bundle: true,
  outfile: join(root, 'dist/extension.js'),
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  sourcemap: true,
  minify: !watch,
});

// 2) Build webview shim (IIFE, browser) — installs window.__REVIEW_CLIENT__
await esbuild.build({
  entryPoints: [join(root, 'src/webviewEntry.ts')],
  bundle: true,
  outfile: join(root, 'media/webview-shim.js'),
  format: 'iife',
  platform: 'browser',
  target: ['chrome100'],
  sourcemap: true,
  minify: !watch,
});

// 3) Extract CSS + JS from browser-app/dist/index.html
const browserAppHtmlPath = join(root, '../browser-app/dist/index.html');
if (!existsSync(browserAppHtmlPath)) {
  console.error(`[build] ${browserAppHtmlPath} not found. Run: npm run build -w @plan-review/browser-app first.`);
  process.exit(1);
}
const appHtml = readFileSync(browserAppHtmlPath, 'utf-8');
const css = /<style>([\s\S]*?)<\/style>/.exec(appHtml)?.[1] ?? '';
const appJs = /<script>([\s\S]*?)<\/script>/.exec(appHtml)?.[1] ?? '';
if (!appJs) {
  console.error('[build] could not extract <script> from browser-app HTML. The bundle shape may have changed.');
  process.exit(1);
}
writeFileSync(join(root, 'media/webview.css'), css, 'utf-8');
writeFileSync(join(root, 'media/webview-app.js'), appJs, 'utf-8');

// 4) Write shell HTML template (consumed by webviewPanelManager at runtime)
const shell = `<!DOCTYPE html>
<html>
<head>
<meta http-equiv="Content-Security-Policy" content="__CSP__">
<link rel="stylesheet" href="__CSS__">
</head>
<body>
<div id="app"></div>
<script nonce="__NONCE__" src="__SHIM__"></script>
<script nonce="__NONCE__" src="__APP__"></script>
</body>
</html>`;
writeFileSync(join(root, 'media/webview.html'), shell, 'utf-8');

console.error('[build] vscode-extension build complete');
