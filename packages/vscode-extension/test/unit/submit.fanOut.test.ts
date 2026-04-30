import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  showInformationMessage, showWarningMessage, showErrorMessage,
  clipboardWriteText, showQuickPick, showTextDocument,
  mockWriteFile, mockMkdir, mockFormatReview, mockSettings,
} = vi.hoisted(() => ({
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  clipboardWriteText: vi.fn().mockRejectedValue(new Error('clipboard boom')),
  showQuickPick: vi.fn(),
  showTextDocument: vi.fn(),
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
  mockMkdir: vi.fn().mockResolvedValue(undefined),
  mockFormatReview: vi.fn().mockReturnValue('# Formatted Review\nsome content'),
  mockSettings: {
    submitTargets: ['clipboard', 'claudeCode'] as string[],
    outputFilePath: '${planDir}/${planName}.review.md',
    planModeDetection: 'auto' as const,
    codeLensEnabled: true,
    askBeforeSubmit: false,
  },
}));

vi.mock('vscode', () => ({
  window: { showInformationMessage, showWarningMessage, showErrorMessage, createOutputChannel: vi.fn(), showQuickPick, showTextDocument },
  workspace: {
    getConfiguration: () => ({ get: (_k: string, d: unknown) => d }),
    getWorkspaceFolder: () => ({ uri: { fsPath: '/w' } }),
  },
  env: { clipboard: { writeText: clipboardWriteText } },
  commands: { getCommands: vi.fn().mockResolvedValue([]), executeCommand: vi.fn() },
  Uri: { file: (p: string) => ({ fsPath: p }) },
}));

vi.mock('node:fs/promises', () => ({
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
}));

vi.mock('@plan-review/core', async () => {
  const actual = await vi.importActual<typeof import('@plan-review/core')>('@plan-review/core');
  return { ...actual, formatReview: mockFormatReview };
});

vi.mock('../../src/settings.js', () => ({
  getSettings: () => ({ ...mockSettings }),
}));

import { runSubmit } from '../../src/submit/index.js';

beforeEach(() => {
  vi.clearAllMocks();
  clipboardWriteText.mockRejectedValue(new Error('clipboard boom'));
  mockFormatReview.mockReturnValue('# Formatted Review\nsome content');
  mockSettings.askBeforeSubmit = false;
  mockSettings.submitTargets = ['clipboard', 'claudeCode'];
  mockSettings.outputFilePath = '${planDir}/${planName}.review.md';
});

const fakeArgs = {
  planFsPath: '/w/plan.md',
  document: { title: 't', metadata: {}, mode: 'generic', sections: [], comments: [] } as any,
  comments: [],
  verdict: null,
  summary: '',
};

describe('runSubmit', () => {
  it('shows error toast when all targets fail', async () => {
    const result = await runSubmit(fakeArgs);
    expect(showErrorMessage).toHaveBeenCalled();
    const msg = showErrorMessage.mock.calls[0][0] as string;
    expect(msg.toLowerCase()).toMatch(/review failed/);
    expect(result).toEqual({ submitted: true });
  });

  it('shows info toast when all targets succeed', async () => {
    clipboardWriteText.mockResolvedValueOnce(undefined);
    const vscode = await import('vscode');
    (vscode.commands.getCommands as any).mockResolvedValue(['claude-code.sendToChat']);
    (vscode.commands.executeCommand as any).mockResolvedValue(undefined);
    const result = await runSubmit(fakeArgs);
    expect(showInformationMessage).toHaveBeenCalled();
    expect(showInformationMessage.mock.calls[0][0]).toMatch(/Review submitted/);
    expect(result).toEqual({ submitted: true });
  });

  it('shows warning toast when some targets fail', async () => {
    clipboardWriteText.mockResolvedValueOnce(undefined);
    const vscode = await import('vscode');
    (vscode.commands.getCommands as any).mockResolvedValue([]);
    const result = await runSubmit(fakeArgs);
    expect(showWarningMessage).toHaveBeenCalled();
    const msg = showWarningMessage.mock.calls[0][0] as string;
    expect(msg).toMatch(/clipboard/);
    expect(msg).toMatch(/claudeCode/);
    expect(result).toEqual({ submitted: true });
  });

  it('passes verdict and summary to formatReview', async () => {
    clipboardWriteText.mockResolvedValueOnce(undefined);
    await runSubmit({ ...fakeArgs, verdict: 'approved', summary: 'LGTM' });
    expect(mockFormatReview).toHaveBeenCalledWith(
      expect.objectContaining({ comments: [] }),
      { verdict: 'approved', summary: 'LGTM' },
    );
  });
});

describe('runSubmit with askBeforeSubmit', () => {
  beforeEach(() => {
    mockSettings.askBeforeSubmit = true;
  });

  it('returns submitted:false when user cancels picker', async () => {
    showQuickPick.mockResolvedValueOnce(undefined);
    const result = await runSubmit(fakeArgs);
    expect(result).toEqual({ submitted: false });
    expect(showInformationMessage).not.toHaveBeenCalled();
    expect(clipboardWriteText).not.toHaveBeenCalled();
  });

  it('returns submitted:false when user picks nothing', async () => {
    showQuickPick.mockResolvedValueOnce([]);
    const result = await runSubmit(fakeArgs);
    expect(result).toEqual({ submitted: false });
  });

  it('copies formatted review to clipboard when clipboard picked', async () => {
    clipboardWriteText.mockResolvedValueOnce(undefined);
    showQuickPick.mockResolvedValueOnce([{ label: '$(clippy) Clipboard', target: 'clipboard' }]);
    const result = await runSubmit(fakeArgs);
    expect(clipboardWriteText).toHaveBeenCalledWith('# Formatted Review\nsome content');
    expect(showInformationMessage).toHaveBeenCalled();
    expect(showInformationMessage.mock.calls[0][0]).toMatch(/clipboard/);
    expect(result).toEqual({ submitted: true });
  });

  it('preserves verdict and summary when picker is enabled', async () => {
    clipboardWriteText.mockResolvedValueOnce(undefined);
    showQuickPick.mockResolvedValueOnce([{ label: '$(clippy) Clipboard', target: 'clipboard' }]);
    const result = await runSubmit({ ...fakeArgs, verdict: 'approved', summary: 'Looks good.' });
    expect(mockFormatReview).toHaveBeenCalledWith(
      expect.objectContaining({ comments: [] }),
      { verdict: 'approved', summary: 'Looks good.' },
    );
    expect(result).toEqual({ submitted: true });
  });

  it('writes formatted review to file when file picked', async () => {
    showQuickPick.mockResolvedValueOnce([{ label: '$(file-add) Save to file', target: 'file' }]);
    const result = await runSubmit(fakeArgs);
    expect(mockMkdir).toHaveBeenCalledWith('/w', { recursive: true });
    expect(mockWriteFile).toHaveBeenCalledWith('/w/plan.review.md', '# Formatted Review\nsome content', 'utf-8');
    expect(showTextDocument).toHaveBeenCalled();
    expect(showInformationMessage).toHaveBeenCalled();
    expect(showInformationMessage.mock.calls[0][0]).toMatch(/file/);
    expect(result).toEqual({ submitted: true });
  });

  it('copies to clipboard and writes to file when both picked', async () => {
    clipboardWriteText.mockResolvedValueOnce(undefined);
    showQuickPick.mockResolvedValueOnce([
      { label: '$(clippy) Clipboard', target: 'clipboard' },
      { label: '$(file-add) Save to file', target: 'file' },
    ]);
    const result = await runSubmit(fakeArgs);
    expect(clipboardWriteText).toHaveBeenCalledWith('# Formatted Review\nsome content');
    expect(mockWriteFile).toHaveBeenCalledWith('/w/plan.review.md', '# Formatted Review\nsome content', 'utf-8');
    expect(showInformationMessage).toHaveBeenCalled();
    const msg = showInformationMessage.mock.calls[0][0] as string;
    expect(msg).toMatch(/clipboard/);
    expect(msg).toMatch(/file/);
    expect(result).toEqual({ submitted: true });
  });

  it('shows warning when clipboard fails but file succeeds', async () => {
    // clipboardWriteText already defaults to rejecting
    showQuickPick.mockResolvedValueOnce([
      { label: '$(clippy) Clipboard', target: 'clipboard' },
      { label: '$(file-add) Save to file', target: 'file' },
    ]);
    const result = await runSubmit(fakeArgs);
    expect(mockWriteFile).toHaveBeenCalled();
    expect(showWarningMessage).toHaveBeenCalled();
    const msg = showWarningMessage.mock.calls[0][0] as string;
    expect(msg).toMatch(/file/);
    expect(msg).toMatch(/clipboard/);
    expect(result).toEqual({ submitted: true });
  });
});
