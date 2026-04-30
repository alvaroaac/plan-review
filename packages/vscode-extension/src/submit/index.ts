import * as vscode from 'vscode';
import { formatReview, type PlanDocument, type ReviewComment, type ReviewVerdict } from '@plan-review/core';
import { getSettings, type SubmitTarget } from '../settings.js';
import { submitToClipboard } from './clipboard.js';
import { submitToFile } from './file.js';
import { submitToOutputChannel } from './outputChannel.js';
import { submitToClaudeCode } from './claudeCode.js';

interface SubmitPickItem extends vscode.QuickPickItem {
  target: SubmitTarget;
}

export async function runSubmit(args: {
  planFsPath: string;
  document: PlanDocument;
  comments: ReviewComment[];
  verdict: ReviewVerdict;
  summary: string;
}): Promise<{ submitted: boolean }> {
  const settings = getSettings();

  let targets: SubmitTarget[];

  if (settings.askBeforeSubmit) {
    const items: SubmitPickItem[] = [
      { label: '$(clippy) Clipboard', target: 'clipboard', picked: true },
      { label: '$(file-add) Save to file', target: 'file' },
    ];
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Where to send the review?',
      canPickMany: true,
    });
    if (!picked || picked.length === 0) return { submitted: false };
    targets = picked.map((p) => p.target);
  } else {
    targets = settings.submitTargets;
  }

  const docWithComments: PlanDocument = { ...args.document, comments: args.comments };
  const formatted = formatReview(docWithComments, {
    verdict: args.verdict,
    summary: args.summary,
  });

  const results = await Promise.allSettled(
    targets.map(async (t: SubmitTarget) => {
      if (t === 'clipboard') return submitToClipboard(formatted);
      if (t === 'file')
        return submitToFile(formatted, {
          template: settings.outputFilePath,
          planFsPath: args.planFsPath,
        });
      if (t === 'outputChannel') return submitToOutputChannel(formatted);
      if (t === 'claudeCode') return submitToClaudeCode(formatted);
      return undefined;
    }),
  );

  const succeeded: string[] = [];
  const failed: { target: string; reason: string }[] = [];
  results.forEach((r, i) => {
    const target = targets[i];
    if (r.status === 'fulfilled') succeeded.push(target);
    else failed.push({ target, reason: r.reason instanceof Error ? r.reason.message : String(r.reason) });
  });

  if (failed.length === 0) {
    vscode.window.showInformationMessage(`Review submitted → ${succeeded.join(', ')}`);
  } else if (succeeded.length > 0) {
    vscode.window.showWarningMessage(
      `Review submitted → ${succeeded.join(', ')}. Failed: ${failed
        .map((f) => `${f.target} (${f.reason})`)
        .join('; ')}`,
    );
  } else {
    vscode.window.showErrorMessage(
      `Review failed: ${failed.map((f) => `${f.target} (${f.reason})`).join('; ')}`,
    );
  }

  return { submitted: true };
}
