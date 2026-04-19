import * as vscode from 'vscode';

const KNOWN_COMMANDS = [
  'claude-code.sendToChat',
  'anthropic.claude-code.sendToChat',
  'claude.sendMessage',
];

export async function submitToClaudeCode(formatted: string): Promise<void> {
  const available = new Set(await vscode.commands.getCommands(true));
  const match = KNOWN_COMMANDS.find((c) => available.has(c));
  if (!match) {
    throw new Error(
      'Claude Code extension command not found. ' +
      'Install the Claude Code extension, or choose a different submit target.',
    );
  }
  await vscode.commands.executeCommand(match, formatted);
}
