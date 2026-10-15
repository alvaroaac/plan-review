import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLAUDE_NOTE, installSkill } from '../src/install-skill.js';

let dir: string;
let skillSrc: string;
let claudeDir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'plan-review-install-'));
  skillSrc = join(dir, 'SKILL.md');
  writeFileSync(skillSrc, '# skill v2\n');
  claudeDir = join(dir, '.claude');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const claudeMd = () => readFileSync(join(claudeDir, 'CLAUDE.md'), 'utf-8');

describe('installSkill', () => {
  it('copies the skill and creates CLAUDE.md with the note on a fresh install', () => {
    const { skillPath } = installSkill(skillSrc, claudeDir);
    expect(readFileSync(skillPath, 'utf-8')).toBe('# skill v2\n');
    expect(claudeMd()).toBe(`${CLAUDE_NOTE}\n`);
  });

  it('overwrites an older skill copy', () => {
    installSkill(skillSrc, claudeDir);
    writeFileSync(skillSrc, '# skill v3\n');
    const { skillPath } = installSkill(skillSrc, claudeDir);
    expect(readFileSync(skillPath, 'utf-8')).toBe('# skill v3\n');
  });

  it('appends the note after existing CLAUDE.md content', () => {
    installSkill(skillSrc, claudeDir);
    writeFileSync(join(claudeDir, 'CLAUDE.md'), '# My rules\n\n- be terse\n');
    installSkill(skillSrc, claudeDir);
    expect(claudeMd()).toBe(`# My rules\n\n- be terse\n\n${CLAUDE_NOTE}\n`);
  });

  it('does not duplicate the note on re-install', () => {
    installSkill(skillSrc, claudeDir);
    installSkill(skillSrc, claudeDir);
    expect(claudeMd().split('plan-review:begin').length).toBe(2);
  });

  it('replaces an outdated note in place and keeps the text around it', () => {
    installSkill(skillSrc, claudeDir);
    writeFileSync(join(claudeDir, 'CLAUDE.md'), '# Before\n\n<!-- plan-review:begin -->\nold note\n<!-- plan-review:end -->\n\n# After\n');
    installSkill(skillSrc, claudeDir);
    expect(claudeMd()).toBe(`# Before\n\n${CLAUDE_NOTE}\n\n# After\n`);
  });
});
