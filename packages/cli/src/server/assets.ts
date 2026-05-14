import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveHtmlPath(): string {
  const candidates = [
    join(__dirname, 'browser', 'index.html'),
    join(__dirname, '..', 'browser', 'index.html'),
    join(__dirname, '..', 'dist', 'browser', 'index.html'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error(`Browser HTML not found. Run 'npm run build' first.\nLooked in:\n  ${candidates.join('\n  ')}`);
}

let cached: string | null = null;

export function getAssetHtml(): string {
  if (!cached) {
    cached = readFileSync(resolveHtmlPath(), 'utf-8');
  }
  return cached;
}
