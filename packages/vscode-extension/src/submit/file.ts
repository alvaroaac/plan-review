import * as vscode from 'vscode';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, basename, isAbsolute, resolve, relative } from 'node:path';

export function resolveFilePath(
  template: string,
  ctx: { planFsPath: string; workspaceFolderFsPath?: string },
): string {
  const planDir = dirname(ctx.planFsPath);
  const planName = basename(ctx.planFsPath).replace(/\.(md|markdown)$/i, '');
  const wf = ctx.workspaceFolderFsPath ?? planDir;
  const resolved = template
    .replaceAll('${planDir}', planDir)
    .replaceAll('${planName}', planName)
    .replaceAll('${workspaceFolder}', wf);
  return isAbsolute(resolved) ? resolved : `${planDir}/${resolved}`;
}

/**
 * Validate that `target` stays within `allowedRoot`.
 * Prevents path-traversal via user-supplied templates (e.g. a malicious
 * `.vscode/settings.json` setting `planReview.outputFilePath` to `../../../etc/...`).
 */
function assertPathWithinRoot(target: string, allowedRoot: string): void {
  const rel = relative(resolve(allowedRoot), resolve(target));
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(
      `Output path "${target}" escapes the allowed root "${allowedRoot}". ` +
      'Adjust planReview.outputFilePath so it stays within your workspace or plan directory.',
    );
  }
}

export async function submitToFile(
  formatted: string,
  opts: { template: string; planFsPath: string },
): Promise<string> {
  const wf = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(opts.planFsPath));
  const planDir = dirname(opts.planFsPath);
  const allowedRoot = wf?.uri.fsPath ?? planDir;
  const path = resolveFilePath(opts.template, {
    planFsPath: opts.planFsPath,
    workspaceFolderFsPath: wf?.uri.fsPath,
  });

  // Guard: resolved path must stay within workspace or plan directory.
  assertPathWithinRoot(path, allowedRoot);

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, formatted, 'utf-8');
  await vscode.window.showTextDocument(vscode.Uri.file(path), { preview: true, preserveFocus: true });
  return path;
}
