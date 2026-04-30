import * as vscode from 'vscode';

export type SubmitTarget = 'clipboard' | 'file' | 'claudeCode' | 'outputChannel';

export interface PlanReviewSettings {
  submitTargets: SubmitTarget[];
  outputFilePath: string;
  planModeDetection: 'auto' | 'always' | 'never';
  codeLensEnabled: boolean;
  askBeforeSubmit: boolean;
}

export function getSettings(): PlanReviewSettings {
  const c = vscode.workspace.getConfiguration('planReview');
  return {
    submitTargets: c.get<SubmitTarget[]>('submitTargets', ['clipboard']),
    outputFilePath: c.get<string>('outputFilePath', '${planDir}/${planName}.review.md'),
    planModeDetection: c.get<'auto' | 'always' | 'never'>('planModeDetection', 'auto'),
    codeLensEnabled: c.get<boolean>('codeLens.enabled', true),
    askBeforeSubmit: c.get<boolean>('askBeforeSubmit', false),
  };
}
