import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const NOTE_BEGIN = '<!-- plan-review:begin -->';
const NOTE_END = '<!-- plan-review:end -->';

export const CLAUDE_NOTE = `${NOTE_BEGIN}
## Open design questions go in the document, not the chat

When brainstorming or writing a spec or plan: settle purpose and scope in chat, then write the document as a draft around your recommendations and put the remaining open choices in it as plan-review \`decision\` / \`assumption\` blocks, instead of asking them one at a time. Present it with the \`plan-review\` skill and continue the same review across revisions. A plan-review that comes back **Approved** counts as explicit approval of the document.
${NOTE_END}`;

export interface InstallResult {
  skillPath: string;
  claudeMdPath: string;
}

/** Copies the skill into `<claudeDir>/skills/plan-review/` and adds or refreshes the plan-review note in `<claudeDir>/CLAUDE.md`. */
export function installSkill(skillSrc: string, claudeDir: string): InstallResult {
  const skillDir = join(claudeDir, 'skills', 'plan-review');
  mkdirSync(skillDir, { recursive: true });
  const skillPath = join(skillDir, 'SKILL.md');
  copyFileSync(skillSrc, skillPath);

  const claudeMdPath = join(claudeDir, 'CLAUDE.md');
  const current = existsSync(claudeMdPath) ? readFileSync(claudeMdPath, 'utf-8') : '';
  writeFileSync(claudeMdPath, withNote(current));
  return { skillPath, claudeMdPath };
}

function withNote(content: string): string {
  const begin = content.indexOf(NOTE_BEGIN);
  const end = content.indexOf(NOTE_END, begin);
  if (begin !== -1 && end !== -1) {
    return content.slice(0, begin) + CLAUDE_NOTE + content.slice(end + NOTE_END.length);
  }
  if (content.trim() === '') return `${CLAUDE_NOTE}\n`;
  return `${content.trimEnd()}\n\n${CLAUDE_NOTE}\n`;
}
