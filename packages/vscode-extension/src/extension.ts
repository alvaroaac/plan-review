import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WebviewPanelManager } from './webviewPanelManager.js';
import { createMessageHandlers, type MessageHandlers } from './messageHandlers.js';
import { isRequest } from './protocol.js';
import type { WebviewRequest } from './protocol.js';
import type { ReviewComment, PlanDocument, ReviewVerdict } from '@plan-review/core';
import { computeContentHash, parse } from '@plan-review/core';
import { runSubmit } from './submit/index.js';
import { disposeChannel } from './submit/outputChannel.js';
import { PlanReviewCodeLensProvider } from './codeLensProvider.js';

let panelManager: WebviewPanelManager;
let handlers: MessageHandlers;

export function activate(context: vscode.ExtensionContext): void {
  panelManager = new WebviewPanelManager();
  handlers = createMessageHandlers({
    submit: async ({ planFsPath, document, comments, verdict, summary }) =>
      runSubmit({ planFsPath, document, comments, verdict, summary }),
  });

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

/**
 * Handle a webview message. Extracted for testability — the full dispatch logic
 * (cachedDoc caching, contentHash fallback, error→err mapping) is unit-testable
 * without a real VS Code panel.
 */
export async function handleWebviewMessage(
  raw: unknown,
  opts: {
    handlers: MessageHandlers;
    planFsPath: string;
    getCachedDoc: () => PlanDocument | null;
    setCachedDoc: (doc: PlanDocument) => void;
    postMessage: (msg: unknown) => void;
  },
): Promise<{ action?: 'close' }> {
  if (!isRequest(raw)) return {};
  const req = raw as WebviewRequest;
  try {
    if (req.method === 'loadDocument') {
      const r = await opts.handlers.loadDocument({ planFsPath: opts.planFsPath });
      opts.setCachedDoc(r.document);
      opts.postMessage({ id: req.id, kind: 'res', result: r });
    } else if (req.method === 'saveSession') {
      const params = req.params as {
        comments: ReviewComment[];
        activeSection: string | null;
        contentHash?: string;
      };
      // Prefer the webview-supplied hash so we preserve stale detection.
      // Fall back to an async file-read hash only for defensive compat with old clients.
      let contentHash = params.contentHash;
      if (!contentHash) {
        const content = await readFile(opts.planFsPath, 'utf-8');
        contentHash = computeContentHash(content);
      }
      await opts.handlers.saveSession({
        planFsPath: opts.planFsPath,
        contentHash,
        comments: params.comments,
        activeSection: params.activeSection,
      });
      opts.postMessage({ id: req.id, kind: 'res', result: null });
    } else if (req.method === 'submitReview') {
      const params = req.params as {
        comments: ReviewComment[];
        verdict: ReviewVerdict;
        summary: string;
      };
      const doc = opts.getCachedDoc();
      if (!doc) throw new Error('document not loaded');
      const r = await opts.handlers.submitReview({
        planFsPath: opts.planFsPath,
        document: doc,
        comments: params.comments,
        verdict: params.verdict,
        summary: params.summary,
      });
      opts.postMessage({ id: req.id, kind: 'res', result: r });
      if (r.submitted) return { action: 'close' };
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

  let cachedDoc: PlanDocument | null = null;

  const watcher = vscode.workspace.createFileSystemWatcher(planUri.fsPath, true, false, true);
  watcher.onDidChange(async () => {
    try {
      const content = await readFile(planUri.fsPath, 'utf-8');
      const newContentHash = computeContentHash(content);
      // Re-parse so cachedDoc stays current — prevents submitting stale doc structure.
      cachedDoc = parse(content);
      panel.webview.postMessage({ kind: 'event', type: 'planChanged', newContentHash });
    } catch { /* file removed or unreadable — ignore */ }
  });
  panel.onDidDispose(() => watcher.dispose());

  panel.webview.onDidReceiveMessage(async (raw: unknown) => {
    const result = await handleWebviewMessage(raw, {
      handlers,
      planFsPath: planUri.fsPath,
      getCachedDoc: () => cachedDoc,
      setCachedDoc: (doc) => { cachedDoc = doc; },
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
