import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// When running from source (vitest), look for pre-built dist/browser/index.html
// When running from dist, the sibling ../browser/ path is used
function resolveHtmlPath(): string {
  const siblingPath = join(__dirname, '..', 'browser', 'index.html');
  if (existsSync(siblingPath)) return siblingPath;

  // Fallback: walk up to project root and look in dist/browser/
  const projectRoot = join(__dirname, '..', '..');
  const distPath = join(projectRoot, 'dist', 'browser', 'index.html');
  if (existsSync(distPath)) return distPath;

  throw new Error(`Browser HTML not found. Run 'npm run build' first.\nLooked in:\n  ${siblingPath}\n  ${distPath}`);
}

let cached: string | null = null;

export function getAssetHtml(): string {
  if (!cached) {
    cached = readFileSync(resolveHtmlPath(), 'utf-8');
  }
  return cached;
}
