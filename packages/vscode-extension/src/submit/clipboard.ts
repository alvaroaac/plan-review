import * as vscode from 'vscode';

export async function submitToClipboard(formatted: string): Promise<void> {
  await vscode.env.clipboard.writeText(formatted);
}
