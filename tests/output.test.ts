import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeOutput, getClipboardCommand, isClaudeAvailable } from '../src/output.js';

// ---------------------------------------------------------------------------
// Mock child_process and fs
// ---------------------------------------------------------------------------

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('node:fs', () => ({
  writeFileSync: vi.fn(),
}));

async function getExecSync() {
  const mod = await import('node:child_process');
  return mod.execSync as ReturnType<typeof vi.fn>;
}

async function getSpawn() {
  const mod = await import('node:child_process');
  return mod.spawn as ReturnType<typeof vi.fn>;
}

async function getWriteFileSync() {
  const mod = await import('node:fs');
  return mod.writeFileSync as ReturnType<typeof vi.fn>;
}

// ---------------------------------------------------------------------------
describe('getClipboardCommand', () => {
  it('returns pbcopy on darwin', () => {
    expect(getClipboardCommand('darwin')).toBe('pbcopy');
  });

  it('returns xclip on linux', () => {
    const cmd = getClipboardCommand('linux');
    expect(cmd).toBe('xclip -selection clipboard');
  });

  it('returns clip on win32', () => {
    expect(getClipboardCommand('win32')).toBe('clip');
  });

  it('returns null on unsupported platform', () => {
    expect(getClipboardCommand('freebsd')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('writeOutput - stdout', () => {
  it('writes to process.stdout', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    writeOutput('Hello output', 'stdout');
    expect(writeSpy).toHaveBeenCalledWith('Hello output\n');
    writeSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
describe('writeOutput - clipboard', () => {
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('calls execSync when clipboard command succeeds', async () => {
    const execSync = await getExecSync();
    // Mock platform to darwin so getClipboardCommand returns 'pbcopy'
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });

    execSync.mockImplementationOnce(() => undefined);
    writeOutput('clip content', 'clipboard');
    expect(execSync).toHaveBeenCalledWith('pbcopy', expect.objectContaining({ input: 'clip content' }));

    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
  });

  it('falls back to stdout when execSync throws', async () => {
    const execSync = await getExecSync();
    Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });

    execSync.mockImplementationOnce(() => { throw new Error('clipboard failed'); });
    writeOutput('fallback content', 'clipboard');
    expect(stdoutWriteSpy).toHaveBeenCalledWith('fallback content\n');

    Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
  });

  it('falls back to stdout when clipboard is unsupported (platform returns null)', async () => {
    Object.defineProperty(process, 'platform', { value: 'freebsd', writable: true });
    writeOutput('unsupported content', 'clipboard');
    expect(stdoutWriteSpy).toHaveBeenCalledWith('unsupported content\n');
    Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
  });
});

// ---------------------------------------------------------------------------
describe('writeOutput - file', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('writes to explicit outputFile path', async () => {
    const writeFileSync = await getWriteFileSync();
    writeOutput('file content', 'file', { outputFile: '/tmp/test.md' });
    expect(writeFileSync).toHaveBeenCalledWith('/tmp/test.md', 'file content', 'utf-8');
  });

  it('derives .review.md path from inputFile', async () => {
    const writeFileSync = await getWriteFileSync();
    writeOutput('review content', 'file', { inputFile: 'plan.md' });
    // Should write to resolved plan.review.md
    const callArg = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(callArg).toMatch(/plan\.review\.md$/);
  });

  it('defaults to review.md when no paths provided', async () => {
    const writeFileSync = await getWriteFileSync();
    writeOutput('default content', 'file', {});
    const callArg = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(callArg).toMatch(/\/review\.md$/);
    expect(callArg).not.toMatch(/\.review\.md$/);
  });
});

// ---------------------------------------------------------------------------
describe('writeOutput - claude', () => {
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('falls back to stdout when claude is not available', async () => {
    const execSync = await getExecSync();
    // Make `which claude` throw to simulate claude not found
    execSync.mockImplementationOnce(() => { throw new Error('not found'); });
    writeOutput('claude content', 'claude');
    expect(stdoutWriteSpy).toHaveBeenCalledWith('claude content\n');
  });

  it('pipes content to claude stdin when claude is available', async () => {
    const execSync = await getExecSync();
    const spawnMock = await getSpawn();

    // Make `which claude` succeed
    execSync.mockImplementationOnce(() => undefined);

    const fakeStdin = { write: vi.fn(), end: vi.fn() };
    spawnMock.mockReturnValueOnce({ stdin: fakeStdin, on: vi.fn() });

    writeOutput('send to claude', 'claude');
    expect(spawnMock).toHaveBeenCalledWith('claude', [], expect.objectContaining({ stdio: ['pipe', 'inherit', 'inherit'] }));
    expect(fakeStdin.write).toHaveBeenCalledWith('send to claude');
    expect(fakeStdin.end).toHaveBeenCalled();
  });

  it('falls back to stdout when claude spawn emits error', async () => {
    const execSync = await getExecSync();
    const spawnMock = await getSpawn();

    // Make `which claude` succeed
    execSync.mockImplementationOnce(() => undefined);

    // Create a mock child that emits error
    const fakeStdin = { write: vi.fn(), end: vi.fn() };
    const errorHandlers: Record<string, Function> = {};
    const fakeChild = {
      stdin: fakeStdin,
      on: vi.fn((event: string, handler: Function) => { errorHandlers[event] = handler; }),
    };
    spawnMock.mockReturnValueOnce(fakeChild);

    writeOutput('error content', 'claude');

    // Trigger the error handler
    errorHandlers['error'](new Error('spawn failed'));
    expect(stdoutWriteSpy).toHaveBeenCalledWith('error content\n');
  });
});

// ---------------------------------------------------------------------------
describe('isClaudeAvailable', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when execSync succeeds', async () => {
    const execSync = await getExecSync();
    execSync.mockImplementationOnce(() => undefined);
    const result = isClaudeAvailable();
    expect(result).toBe(true);
  });

  it('returns false when execSync throws', async () => {
    const execSync = await getExecSync();
    execSync.mockImplementationOnce(() => { throw new Error('not found'); });
    const result = isClaudeAvailable();
    expect(result).toBe(false);
  });
});
