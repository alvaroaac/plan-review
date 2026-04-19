import * as vscode from 'vscode';
import { formatReview, type PlanDocument, type ReviewComment } from '@plan-review/core';
import { getSettings, type SubmitTarget } from '../settings.js';
import { submitToClipboard } from './clipboard.js';
import { submitToFile } from './file.js';
import { submitToOutputChannel } from './outputChannel.js';
import { submitToClaudeCode } from './claudeCode.js';

export async function runSubmit(args: {
  planFsPath: string;
  document: PlanDocument;
  comments: ReviewComment[];
}): Promise<void> {
  const settings = getSettings();
  const docWithComments: PlanDocument = { ...args.document, comments: args.comments };
  const formatted = formatReview(docWithComments);

  const results = await Promise.allSettled(
    settings.submitTargets.map(async (t: SubmitTarget) => {
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
    const target = settings.submitTargets[i];
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
}
