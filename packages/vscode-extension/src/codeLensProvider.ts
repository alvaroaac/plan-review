import * as vscode from 'vscode';
import { parse } from '@plan-review/core';
import { getSettings } from './settings.js';

export interface ComputedLens { line: number; }

export function computeCodeLenses(
  markdown: string,
  opts: { planModeDetection: 'auto' | 'always' | 'never'; codeLensEnabled: boolean },
): ComputedLens[] {
  if (!opts.codeLensEnabled) return [];
  if (opts.planModeDetection === 'never') return [];
  if (opts.planModeDetection === 'always') return [{ line: 0 }];
  // auto: consult parser
  try {
    const doc = parse(markdown);
    return doc.mode === 'plan' ? [{ line: 0 }] : [];
  } catch {
    return [];
  }
}

export class PlanReviewCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    const s = getSettings();
    return computeCodeLenses(doc.getText(), s).map((l) => new vscode.CodeLens(
      new vscode.Range(l.line, 0, l.line, 1),
      { title: '▶ Review this plan', command: 'plan-review.open', arguments: [doc.uri] },
    ));
  }
}
