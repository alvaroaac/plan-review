import { describe, it, expect, vi } from 'vitest';
import { WebviewPanelManager } from '../../src/webviewPanelManager.js';

function makeFakePanel() {
  const disposeListeners: Array<() => void> = [];
  return {
    reveal: vi.fn(),
    onDidDispose: vi.fn((cb: () => void) => { disposeListeners.push(cb); return { dispose: () => {} }; }),
    dispose: () => disposeListeners.forEach((l) => l()),
    webview: { postMessage: vi.fn(), onDidReceiveMessage: vi.fn(() => ({ dispose: () => {} })) },
  };
}

describe('WebviewPanelManager', () => {
  it('returns the same panel for the same URI', () => {
    const mgr = new WebviewPanelManager();
    const p1 = makeFakePanel() as any;
    mgr.track('file:///a/plan.md', p1);
    expect(mgr.find('file:///a/plan.md')).toBe(p1);
  });

  it('removes a panel when it disposes', () => {
    const mgr = new WebviewPanelManager();
    const p1 = makeFakePanel() as any;
    mgr.track('file:///a/plan.md', p1);
    p1.dispose();
    expect(mgr.find('file:///a/plan.md')).toBeUndefined();
  });
});
