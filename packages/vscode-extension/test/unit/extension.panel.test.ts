import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  createMessageHandlers: vi.fn(), registerCommand: vi.fn(), createWebviewPanel: vi.fn(),
  createFileSystemWatcher: vi.fn(), openTextDocument: vi.fn(),
}));
vi.mock('../../src/messageHandlers.js', () => ({ createMessageHandlers: mocks.createMessageHandlers }));
vi.mock('node:fs', () => ({ readFileSync: () => '__CSP__ __NONCE__ __CSS__ __SHIM__ __APP__' }));
vi.mock('vscode', () => ({
  window: { createWebviewPanel: mocks.createWebviewPanel },
  commands: { registerCommand: mocks.registerCommand },
  workspace: {
    createFileSystemWatcher: mocks.createFileSystemWatcher,
    openTextDocument: mocks.openTextDocument,
    onDidChangeConfiguration: vi.fn(),
  },
  languages: { registerCodeLensProvider: vi.fn() },
  ViewColumn: { Beside: 2 },
  Uri: { joinPath: (base: { fsPath: string }, ...paths: string[]) => ({ fsPath: [base.fsPath, ...paths].join('/'), toString: () => paths.join('/') }) },
}));
import { activate } from '../../src/extension.js';

function panel() {
  const disposals: (() => void)[] = [];
  return {
    reveal: vi.fn(),
    onDidDispose: vi.fn((fn: () => void) => { disposals.push(fn); }),
    dispose: vi.fn(() => disposals.forEach((fn) => fn())),
    webview: { html: '', cspSource: 'test', asWebviewUri: (uri: unknown) => uri, postMessage: vi.fn(), onDidReceiveMessage: vi.fn() },
  };
}
beforeEach(() => { vi.clearAllMocks(); });

describe('panel lifecycle', () => {
  it('uses panel-local handlers, sends only planChanged on file saves and does nothing extra on dispose', async () => {
    const handlers = { loadDocument: vi.fn().mockResolvedValue({ review: { id: 'rv_abcdefgh' } }), saveProgress: vi.fn(), submitReview: vi.fn() };
    mocks.createMessageHandlers.mockReturnValue(handlers);
    const first = panel();
    const second = panel();
    mocks.createWebviewPanel.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const watchers = [
      { onDidChange: vi.fn(), dispose: vi.fn() },
      { onDidChange: vi.fn(), dispose: vi.fn() },
    ];
    mocks.createFileSystemWatcher.mockReturnValueOnce(watchers[0]).mockReturnValueOnce(watchers[1]);
    mocks.openTextDocument.mockResolvedValue({ getText: () => '# Current editor text' });
    activate({ subscriptions: [], extensionUri: { fsPath: '/extension' } } as any);
    const open = mocks.registerCommand.mock.calls[0][1];
    const uri = { fsPath: '/work/plan.md', path: '/work/plan.md', toString: () => 'file:///work/plan.md' };
    await open(uri);
    await open(uri);
    expect(first.reveal).toHaveBeenCalledOnce();
    expect(mocks.createMessageHandlers).toHaveBeenCalledTimes(1);
    const receive = first.webview.onDidReceiveMessage.mock.calls[0][0];
    await receive({ id: 'r1', kind: 'req', method: 'loadDocument' });
    expect(mocks.openTextDocument).toHaveBeenCalledWith(uri);
    expect(handlers.loadDocument).toHaveBeenLastCalledWith({ planFsPath: uri.fsPath, markdown: '# Current editor text' });
    handlers.submitReview.mockRejectedValueOnce(new Error('Submit cancelled — no destination chosen.'));
    await receive({ id: 'cancelled', kind: 'req', method: 'submitReview', params: { verdict: 'approved', summary: '' } });
    expect(first.dispose).not.toHaveBeenCalled();
    expect(first.webview.postMessage).toHaveBeenLastCalledWith({ id: 'cancelled', kind: 'err', error: 'Submit cancelled — no destination chosen.' });
    handlers.submitReview.mockClear();
    handlers.loadDocument.mockClear();
    first.webview.postMessage.mockClear();
    await watchers[0].onDidChange.mock.calls[0][0]();
    expect(first.webview.postMessage).toHaveBeenCalledExactlyOnceWith({ kind: 'event', type: 'planChanged' });
    expect(handlers.loadDocument).not.toHaveBeenCalled();
    expect(handlers.saveProgress).not.toHaveBeenCalled();
    first.dispose();
    expect(watchers[0].dispose).toHaveBeenCalledOnce();
    expect(handlers.submitReview).not.toHaveBeenCalled();
    expect(handlers.saveProgress).not.toHaveBeenCalled();
    await open(uri);
    expect(mocks.createMessageHandlers).toHaveBeenCalledTimes(2);
  });
});
