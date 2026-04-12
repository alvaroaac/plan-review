import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const entryPoint = join(projectRoot, 'src', 'index.ts');

function runCli(args: string[], stdinData?: string) {
  return spawnSync('npx', ['tsx', entryPoint, ...args], {
    cwd: projectRoot,
    encoding: 'utf-8',
    input: stdinData,
    timeout: 15000,
  });
}

describe('index.ts CLI', () => {
  it('--help exits with code 0 and mentions plan-review', () => {
    const result = runCli(['--help']);
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).toContain('plan-review');
  });

  it('--version outputs 0.1.0', () => {
    const result = runCli(['--version']);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('0.1.0');
  });

  it('exits 1 with "File not found" when file does not exist', () => {
    const result = runCli(['nonexistent.md']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('File not found');
  });

  it('exits 1 with "Invalid output target" for invalid -o value', () => {
    const fixtureFile = join(__dirname, 'fixtures', 'generic-document.md');
    const result = runCli(['-o', 'invalid', fixtureFile]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Invalid output target');
  });
});
