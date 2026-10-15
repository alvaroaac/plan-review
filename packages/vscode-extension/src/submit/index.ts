import * as vscode from 'vscode';
import { getSettings, type SubmitTarget } from '../settings.js';
import { submitToClipboard } from './clipboard.js';
import { submitToFile } from './file.js';
import { submitToOutputChannel } from './outputChannel.js';
import { submitToClaudeCode } from './claudeCode.js';

interface SubmitPickItem extends vscode.QuickPickItem {
  target: SubmitTarget;
}

export async function chooseSubmitTargets(): Promise<SubmitTarget[] | undefined> {
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
    if (!picked || picked.length === 0) return undefined;
    targets = picked.map((p) => p.target);
  } else {
    targets = settings.submitTargets;
  }

  return targets.length === 0 ? undefined : targets;
}

export async function deliverReview(args: {
  planFsPath: string;
  output: string;
  targets: SubmitTarget[];
}): Promise<void> {
  const settings = getSettings();
  const { targets } = args;
  const results = await Promise.allSettled(
    targets.map(async (t: SubmitTarget) => {
      if (t === 'clipboard') return submitToClipboard(args.output);
      if (t === 'file')
        return submitToFile(args.output, {
          template: settings.outputFilePath,
          planFsPath: args.planFsPath,
        });
      if (t === 'outputChannel') return submitToOutputChannel(args.output);
      if (t === 'claudeCode') return submitToClaudeCode(args.output);
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
}
