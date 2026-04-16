import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf-8'));
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

  it('--help shows -o option without a default value', () => {
    const result = runCli(['--help']);
    expect(result.status).toBe(0);
    const helpText = result.stdout + result.stderr;
    expect(helpText).toContain('-o, --output <target>');
    // No "(default: stdout)" should appear since we removed the default
    expect(helpText).not.toContain('default: stdout');
  });

  it('--version outputs the version from package.json', () => {
    const result = runCli(['--version']);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(pkg.version);
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

  it('--fresh flag is accepted without error', () => {
    const fixtureFile = join(__dirname, 'fixtures', 'generic-document.md');
    const result = spawnSync('npx', ['tsx', entryPoint, fixtureFile, '--fresh', '-o', 'stdout'], {
      cwd: projectRoot,
      encoding: 'utf-8',
      timeout: 15000,
      input: 'done\n',
    });
    expect(result.stderr).not.toContain('unknown option');
  });

  it('sessions subcommand runs without error', () => {
    const result = runCli(['sessions']);
    expect(result.status).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain('.plan-review/sessions');
  });
});
