import { describe, it, expect, vi } from 'vitest';
import { writeOutput, getClipboardCommand, isClaudeAvailable } from '../src/output.js';

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

describe('writeOutput - stdout', () => {
  it('writes to process.stdout', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    writeOutput('Hello output', 'stdout');
    expect(writeSpy).toHaveBeenCalledWith('Hello output\n');
    writeSpy.mockRestore();
  });
});

describe('isClaudeAvailable', () => {
  it('returns a boolean', () => {
    const result = isClaudeAvailable();
    expect(typeof result).toBe('boolean');
  });
});
