import { describe, it, expect, vi } from 'vitest';
import { submitToClipboard } from '../../src/submit/clipboard.js';

vi.mock('vscode', () => ({
  env: { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } },
}));

describe('submitToClipboard', () => {
  it('writes formatted text to the clipboard', async () => {
    const vscode = await import('vscode');
    await submitToClipboard('# review');
    expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith('# review');
  });
});
