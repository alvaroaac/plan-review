import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getCommands, executeCommand } = vi.hoisted(() => ({
  getCommands: vi.fn(),
  executeCommand: vi.fn(),
}));

vi.mock('vscode', () => ({
  commands: {
    getCommands: (filter?: boolean) => getCommands(filter),
    executeCommand: (...args: unknown[]) => executeCommand(...args),
  },
  window: { showWarningMessage: vi.fn() },
}));

import { submitToClaudeCode } from '../../src/submit/claudeCode.js';

beforeEach(() => { vi.clearAllMocks(); });

describe('submitToClaudeCode', () => {
  it('dispatches to discovered command', async () => {
    getCommands.mockResolvedValue(['other.cmd', 'claude-code.sendToChat']);
    executeCommand.mockResolvedValue(undefined);
    await submitToClaudeCode('# review');
    expect(executeCommand).toHaveBeenCalledWith('claude-code.sendToChat', '# review');
  });
  it('throws a descriptive error when no matching command exists', async () => {
    getCommands.mockResolvedValue(['other.cmd']);
    await expect(submitToClaudeCode('x')).rejects.toThrow(/Claude Code extension/i);
  });
});
