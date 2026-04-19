import * as vscode from 'vscode';

let channel: vscode.OutputChannel | null = null;

/** Dispose the cached output channel (call from extension deactivate). */
export function disposeChannel(): void {
  channel?.dispose();
  channel = null;
}

/** Reset for tests (no dispose — mocked channels lack a real dispose). */
export function __resetChannel(): void {
  channel = null;
}

export async function submitToOutputChannel(formatted: string): Promise<void> {
  if (!channel) channel = vscode.window.createOutputChannel('Plan Review');
  channel.append(formatted + '\n\n');
  channel.show(true);
}
