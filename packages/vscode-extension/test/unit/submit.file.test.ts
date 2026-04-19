import { describe, it, expect, vi } from 'vitest';

const { showTextDocument, writeFile: mockWriteFile, mkdir: mockMkdir } = vi.hoisted(() => ({
  showTextDocument: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('vscode', () => ({
  workspace: { getWorkspaceFolder: vi.fn(() => ({ uri: { fsPath: '/work' } })) },
  window: { showTextDocument },
  Uri: { file: (p: string) => ({ fsPath: p }) },
}));

vi.mock('node:fs/promises', () => ({
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
}));

import { resolveFilePath, submitToFile } from '../../src/submit/file.js';

describe('resolveFilePath', () => {
  it('expands ${planDir}, ${planName}', () => {
    expect(resolveFilePath('${planDir}/${planName}.review.md', {
      planFsPath: '/work/docs/plans/p.md',
      workspaceFolderFsPath: '/work',
    })).toBe('/work/docs/plans/p.review.md');
  });
  it('expands ${workspaceFolder}', () => {
    expect(resolveFilePath('${workspaceFolder}/reviews/${planName}.md', {
      planFsPath: '/work/a/b.md',
      workspaceFolderFsPath: '/work',
    })).toBe('/work/reviews/b.md');
  });
  it('returns absolute path when template is already absolute', () => {
    expect(resolveFilePath('/tmp/out.md', {
      planFsPath: '/work/a.md',
      workspaceFolderFsPath: '/work',
    })).toBe('/tmp/out.md');
  });
});

describe('submitToFile — path traversal guard', () => {
  it('rejects a template that escapes the workspace root', async () => {
    await expect(
      submitToFile('review text', {
        template: '../../../etc/cron.d/${planName}',
        planFsPath: '/work/plans/p.md',
      }),
    ).rejects.toThrow(/escapes the allowed root/);
  });

  it('allows a template that stays within the workspace', async () => {
    await expect(
      submitToFile('review text', {
        template: '${planDir}/${planName}.review.md',
        planFsPath: '/work/plans/p.md',
      }),
    ).resolves.toBe('/work/plans/p.review.md');
  });
});
