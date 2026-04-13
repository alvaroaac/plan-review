import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(__dirname, '..', 'browser', 'index.html');

let cached: string | null = null;

export function getAssetHtml(): string {
  if (!cached) {
    cached = readFileSync(htmlPath, 'utf-8');
  }
  return cached;
}
