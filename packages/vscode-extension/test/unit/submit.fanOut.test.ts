import { describe, it, expect, vi, beforeEach } from 'vitest';

const { showInformationMessage, showWarningMessage, showErrorMessage, clipboardWriteText } = vi.hoisted(() => ({
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  clipboardWriteText: vi.fn().mockRejectedValue(new Error('clipboard boom')),
}));

vi.mock('vscode', () => ({
  window: { showInformationMessage, showWarningMessage, showErrorMessage, createOutputChannel: vi.fn() },
  workspace: { getConfiguration: () => ({ get: (_k: string, d: unknown) => d }), getWorkspaceFolder: () => undefined },
  env: { clipboard: { writeText: clipboardWriteText } },
  commands: { getCommands: vi.fn().mockResolvedValue([]), executeCommand: vi.fn() },
  Uri: { file: (p: string) => ({ fsPath: p }) },
}));

vi.mock('../../src/settings.js', () => ({
  getSettings: () => ({
    submitTargets: ['clipboard', 'claudeCode'],
    outputFilePath: '',
    planModeDetection: 'auto',
    codeLensEnabled: true,
  }),
}));

import { runSubmit } from '../../src/submit/index.js';

beforeEach(() => { vi.clearAllMocks(); clipboardWriteText.mockRejectedValue(new Error('clipboard boom')); });

describe('runSubmit', () => {
  it('shows error toast when all targets fail', async () => {
    await runSubmit({
      planFsPath: '/w/plan.md',
      document: { title: 't', metadata: {}, mode: 'generic', sections: [], comments: [] } as any,
      comments: [],
    });
    expect(showErrorMessage).toHaveBeenCalled();
    const msg = showErrorMessage.mock.calls[0][0] as string;
    expect(msg.toLowerCase()).toMatch(/review failed/);
  });

  it('shows info toast when all targets succeed', async () => {
    clipboardWriteText.mockResolvedValueOnce(undefined);
    // claudeCode also configured — make it succeed by stubbing getCommands to return a known name
    const vscode = await import('vscode');
    (vscode.commands.getCommands as any).mockResolvedValue(['claude-code.sendToChat']);
    (vscode.commands.executeCommand as any).mockResolvedValue(undefined);
    await runSubmit({
      planFsPath: '/w/plan.md',
      document: { title: 't', metadata: {}, mode: 'generic', sections: [], comments: [] } as any,
      comments: [],
    });
    expect(showInformationMessage).toHaveBeenCalled();
    expect(showInformationMessage.mock.calls[0][0]).toMatch(/Review submitted/);
  });

  it('shows warning toast when some targets fail', async () => {
    clipboardWriteText.mockResolvedValueOnce(undefined);
    // claudeCode fails because no matching command
    const vscode = await import('vscode');
    (vscode.commands.getCommands as any).mockResolvedValue([]);
    await runSubmit({
      planFsPath: '/w/plan.md',
      document: { title: 't', metadata: {}, mode: 'generic', sections: [], comments: [] } as any,
      comments: [],
    });
    expect(showWarningMessage).toHaveBeenCalled();
    const msg = showWarningMessage.mock.calls[0][0] as string;
    expect(msg).toMatch(/clipboard/);
    expect(msg).toMatch(/claudeCode/);
  });
});
