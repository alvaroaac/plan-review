import type * as vscode from 'vscode';

export class WebviewPanelManager implements vscode.Disposable {
  private readonly panels = new Map<string, vscode.WebviewPanel>();

  track(uriKey: string, panel: vscode.WebviewPanel): void {
    this.panels.set(uriKey, panel);
    panel.onDidDispose(() => this.panels.delete(uriKey));
  }

  find(uriKey: string): vscode.WebviewPanel | undefined {
    return this.panels.get(uriKey);
  }

  keys(): IterableIterator<string> {
    return this.panels.keys();
  }

  /** Dispose all tracked panels (called on extension deactivation). */
  dispose(): void {
    for (const panel of this.panels.values()) {
      panel.dispose();
    }
    this.panels.clear();
  }
}
