import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleWebviewMessage } from '../../src/extension.js';
import type { MessageHandlers } from '../../src/messageHandlers.js';
import type { PlanDocument, ReviewComment } from '@plan-review/core';

vi.mock('vscode', () => ({
  workspace: { getConfiguration: () => ({ get: (_k: string, d: unknown) => d }), getWorkspaceFolder: () => undefined },
  window: { showInformationMessage: vi.fn(), showWarningMessage: vi.fn(), showErrorMessage: vi.fn(), createOutputChannel: vi.fn() },
  env: { clipboard: { writeText: vi.fn() } },
  commands: { getCommands: vi.fn().mockResolvedValue([]), executeCommand: vi.fn(), registerCommand: vi.fn() },
  languages: { registerCodeLensProvider: vi.fn() },
  Uri: { file: (p: string) => ({ fsPath: p }), joinPath: vi.fn() },
  ViewColumn: { Beside: 2 },
  Range: vi.fn(),
  CodeLens: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('# Plan\n## S\nbody\n'),
}));

vi.mock('@plan-review/core', () => ({
  computeContentHash: vi.fn(() => 'sha256:abc'),
  parse: vi.fn(() => ({ title: 'Plan', mode: 'plan', sections: [], comments: [] })),
}));

const fakeDoc: PlanDocument = {
  title: 'Plan',
  metadata: {},
  mode: 'plan',
  sections: [{ id: 's', title: 'S', depth: 2, lines: [], rawContent: 'body' }],
  comments: [],
};

function makeHandlers(overrides?: Partial<MessageHandlers>): MessageHandlers {
  return {
    loadDocument: vi.fn().mockResolvedValue({
      document: fakeDoc,
      contentHash: 'sha256:abc',
      restoredSession: undefined,
    }),
    saveSession: vi.fn().mockResolvedValue(undefined),
    submitReview: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

describe('handleWebviewMessage', () => {
  let postMessage: ReturnType<typeof vi.fn>;
  let cachedDoc: PlanDocument | null;

  beforeEach(() => {
    postMessage = vi.fn();
    cachedDoc = null;
    vi.clearAllMocks();
  });

  function opts(h?: MessageHandlers) {
    return {
      handlers: h ?? makeHandlers(),
      planFsPath: '/work/plan.md',
      getCachedDoc: () => cachedDoc,
      setCachedDoc: (doc: PlanDocument) => { cachedDoc = doc; },
      postMessage,
    };
  }

  it('ignores non-request messages', async () => {
    await handleWebviewMessage({ kind: 'not-req' }, opts());
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('dispatches loadDocument and caches the doc', async () => {
    const h = makeHandlers();
    await handleWebviewMessage(
      { id: 'r1', kind: 'req', method: 'loadDocument' },
      opts(h),
    );
    expect(h.loadDocument).toHaveBeenCalledWith({ planFsPath: '/work/plan.md' });
    expect(cachedDoc).toBe(fakeDoc);
    expect(postMessage).toHaveBeenCalledWith({
      id: 'r1', kind: 'res',
      result: { document: fakeDoc, contentHash: 'sha256:abc', restoredSession: undefined },
    });
  });

  it('dispatches saveSession with webview-supplied contentHash', async () => {
    const h = makeHandlers();
    await handleWebviewMessage(
      { id: 'r2', kind: 'req', method: 'saveSession', params: {
        comments: [], activeSection: null, contentHash: 'sha256:user',
      }},
      opts(h),
    );
    expect(h.saveSession).toHaveBeenCalledWith({
      planFsPath: '/work/plan.md',
      contentHash: 'sha256:user',
      comments: [],
      activeSection: null,
    });
    expect(postMessage).toHaveBeenCalledWith({ id: 'r2', kind: 'res', result: null });
  });

  it('falls back to async file-read hash when contentHash missing', async () => {
    const h = makeHandlers();
    await handleWebviewMessage(
      { id: 'r3', kind: 'req', method: 'saveSession', params: {
        comments: [], activeSection: null,
      }},
      opts(h),
    );
    // Should have used the mocked computeContentHash result
    expect(h.saveSession).toHaveBeenCalledWith(
      expect.objectContaining({ contentHash: 'sha256:abc' }),
    );
  });

  it('dispatches submitReview using cachedDoc', async () => {
    const h = makeHandlers();
    cachedDoc = fakeDoc;
    await handleWebviewMessage(
      { id: 'r4', kind: 'req', method: 'submitReview', params: { comments: [] } },
      opts(h),
    );
    expect(h.submitReview).toHaveBeenCalledWith({
      planFsPath: '/work/plan.md',
      document: fakeDoc,
      comments: [],
    });
    expect(postMessage).toHaveBeenCalledWith({ id: 'r4', kind: 'res', result: { ok: true } });
  });

  it('returns error when submitReview called without loaded doc', async () => {
    cachedDoc = null;
    await handleWebviewMessage(
      { id: 'r5', kind: 'req', method: 'submitReview', params: { comments: [] } },
      opts(),
    );
    expect(postMessage).toHaveBeenCalledWith({
      id: 'r5', kind: 'err', error: 'document not loaded',
    });
  });

  it('maps handler errors to err responses', async () => {
    const h = makeHandlers({
      loadDocument: vi.fn().mockRejectedValue(new Error('disk on fire')),
    });
    await handleWebviewMessage(
      { id: 'r6', kind: 'req', method: 'loadDocument' },
      opts(h),
    );
    expect(postMessage).toHaveBeenCalledWith({
      id: 'r6', kind: 'err', error: 'disk on fire',
    });
  });
});
