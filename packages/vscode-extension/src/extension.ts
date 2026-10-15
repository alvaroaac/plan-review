import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WebviewPanelManager } from './webviewPanelManager.js';
import { createMessageHandlers, type MessageHandlers } from './messageHandlers.js';
import { isRequest, isProgressUpdate, isSubmitRequest } from './protocol.js';
import type { HostEvent } from './protocol.js';
import { runSubmit } from './submit/index.js';
import { disposeChannel } from './submit/outputChannel.js';
import { PlanReviewCodeLensProvider } from './codeLensProvider.js';

let panelManager: WebviewPanelManager;

export function activate(context: vscode.ExtensionContext): void {
  panelManager = new WebviewPanelManager();

  // Register panelManager for automatic disposal on deactivation
  context.subscriptions.push(panelManager);

  context.subscriptions.push(
    vscode.commands.registerCommand('plan-review.open', async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) {
        vscode.window.showWarningMessage('Plan Review: no file to review.');
        return;
      }
      openOrFocusPanel(context, target);
    }),
  );

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { language: 'markdown', scheme: 'file' },
      new PlanReviewCodeLensProvider(),
    ),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      // Any planReview setting can affect lens visibility (e.g. planModeDetection),
      // not just planReview.codeLens.*. Refresh on the whole namespace.
      if (e.affectsConfiguration('planReview')) {
        vscode.commands.executeCommand('editor.action.codeLensRefresh');
      }
    }),
  );
}

/** Dispatch validated webview requests to the panel's review handlers. */
export async function handleWebviewMessage(
  raw: unknown,
  opts: {
    handlers: MessageHandlers;
    planFsPath: string;
    getMarkdown: () => Promise<string>;
    postMessage: (msg: unknown) => void;
  },
): Promise<{ action?: 'close' }> {
  if (!isRequest(raw)) return {};
  const req = raw;
  try {
    if (req.method === 'loadDocument') {
      const loaded = await opts.handlers.loadDocument({
        planFsPath: opts.planFsPath,
        markdown: await opts.getMarkdown(),
      });
      opts.postMessage({ id: req.id, kind: 'res', result: loaded });
    } else if (req.method === 'saveProgress') {
      if (!isProgressUpdate(req.params)) throw new Error('invalid saveProgress params');
      await opts.handlers.saveProgress(req.params);
      opts.postMessage({ id: req.id, kind: 'res', result: null });
    } else if (req.method === 'submitReview') {
      if (!isSubmitRequest(req.params)) throw new Error('invalid submitReview params');
      const result = await opts.handlers.submitReview(req.params);
      opts.postMessage({ id: req.id, kind: 'res', result });
      return { action: 'close' };
    }
  } catch (err) {
    opts.postMessage({ id: req.id, kind: 'err', error: (err as Error).message });
  }
  return {};
}

function openOrFocusPanel(context: vscode.ExtensionContext, planUri: vscode.Uri): void {
  const key = planUri.toString();
  const existing = panelManager.find(key);
  if (existing) { existing.reveal(); return; }

  const panel = vscode.window.createWebviewPanel(
    'planReview',
    `Plan Review — ${planUri.path.split('/').pop()}`,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
    },
  );

  panel.webview.html = renderHtml(panel, context.extensionUri);
  panelManager.track(key, panel);

  const handlers = createMessageHandlers({
    submit: async (args) => { await runSubmit(args); },
  });

  const watcher = vscode.workspace.createFileSystemWatcher(planUri.fsPath, true, false, true);
  watcher.onDidChange(() => {
    // The webview flushes pending autosave before loadDocument re-anchors threads.
    panel.webview.postMessage({ kind: 'event', type: 'planChanged' } satisfies HostEvent);
  });
  panel.onDidDispose(() => watcher.dispose());

  panel.webview.onDidReceiveMessage(async (raw: unknown) => {
    const result = await handleWebviewMessage(raw, {
      handlers,
      planFsPath: planUri.fsPath,
      getMarkdown: async () => (await vscode.workspace.openTextDocument(planUri)).getText(),
      postMessage: (msg) => panel.webview.postMessage(msg),
    });
    if (result.action === 'close') {
      panel.dispose();
    }
  });
}

function renderHtml(panel: vscode.WebviewPanel, extensionUri: vscode.Uri): string {
  const media = vscode.Uri.joinPath(extensionUri, 'media');
  const shell = readFileSync(join(media.fsPath, 'webview.html'), 'utf-8');
  const nonce = randomBytes(16).toString('hex');
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' ${panel.webview.cspSource}`,
    `style-src ${panel.webview.cspSource} 'unsafe-inline'`,
    `img-src ${panel.webview.cspSource} data:`,
  ].join('; ');
  return shell
    .replace('__CSP__', csp)
    .replaceAll('__NONCE__', nonce)
    .replace('__CSS__', panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'webview.css')).toString())
    .replace('__SHIM__', panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'webview-shim.js')).toString())
    .replace('__APP__', panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'webview-app.js')).toString());
}

export function deactivate(): void {
  // panelManager is registered in context.subscriptions and auto-disposed,
  // but disposeChannel must be called explicitly since it's module-level state.
  disposeChannel();
}
