import { Marked } from 'marked';
import { hashItem } from './reviewModel.js';
import type { PlanDocument, ReviewItem } from './types.js';

export interface AgentReply {
  threadId: string;
  body: string;
  sectionId: string;
}

export interface ExtractResult {
  doc: PlanDocument;
  items: ReviewItem[];
  replies: AgentReply[];
  warnings: string[];
}

const marked = new Marked();

// Re-exported here so the browser bundle reaches the shared block splitter
// through the browser-safe `@plan-review/core/items` entry.
export { findLineRun, ITEM_FENCE_RE, renderToLineBlocks, type LineBlock } from './lineBlocks.js';

export function extractItems(doc: PlanDocument): ExtractResult {
  const items: ReviewItem[] = [];
  const replies: AgentReply[] = [];
  const warnings: string[] = [];
  const seenIds = new Set<string>();
  const sections = doc.sections.map((section) => {
    // marked normalizes CRLF to LF; map token offsets back to the original bytes.
    const offsets = [0];
    for (let i = 0; i < section.body.length; i++) {
      if (section.body[i] === '\r' && section.body[i + 1] === '\n') i++;
      offsets.push(i + 1);
    }
    let offset = 0;
    let keptFrom = 0;
    let body = '';
    for (const token of marked.lexer(section.body)) {
      const start = offsets[offset];
      offset += token.raw.length;
      if (token.type !== 'code' || token.codeBlockStyle === 'indented') continue;
      const info: string[] = (token.lang ?? '').trim().split(/\s+/);
      const kind = info[0];
      if (kind !== 'decision' && kind !== 'assumption' && kind !== 'reply') continue;
      const line = section.body.slice(0, start).split(/\r\n|\r|\n/).length;
      if (kind === 'reply') {
        body += section.body.slice(keptFrom, start);
        keptFrom = offsets[offset];
        const threadId = info.find((part) => part.startsWith('thread='))?.slice(7);
        const replyBody = token.text.trim();
        if (!replyBody) warnings.push(`Reply at line ${line}: empty body`);
        else if (threadId) replies.push({ threadId, body: replyBody, sectionId: section.id });
        else warnings.push(`Reply at line ${line}: missing thread`);
        continue;
      }
      const id = info.find((part) => part.startsWith('id='))?.slice(3) ?? '';
      const location = id || `line ${line}`;
      const warn = (reason: string): void => { warnings.push(`${location}: ${reason}`); };
      if (!id) { warn('missing id'); continue; }
      if (!/^[a-z0-9-]+$/.test(id)) { warn('invalid id'); continue; }
      if (seenIds.has(id)) { warn('duplicate id'); continue; }
      seenIds.add(id);
      const item = parseItem(kind, id, token.text, section.id, warn);
      if (item) items.push(item);
    }
    body += section.body.slice(keptFrom);
    return { ...section, body };
  });
  return { doc: { ...doc, sections }, items, replies, warnings };
}

function parseItem(
  kind: ReviewItem['kind'],
  id: string,
  body: string,
  sectionId: string,
  warn: (reason: string) => void,
): ReviewItem | undefined {
  const questionField = kind === 'decision' ? 'question' : 'statement';
  const fields = new Map<string, string>();
  const options: NonNullable<ReviewItem['options']> = [];
  const keys = new Set<string>();
  const notices: string[] = [];
  let optionError: string | undefined;
  let hasAssumptionOptions = false;
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (/^-\s/.test(trimmed)) {
      if (kind === 'assumption') {
        hasAssumptionOptions = true;
        continue;
      }
      const option = trimmed.match(/^-\s+([A-Z]):\s*(.*)$/);
      if (!option) {
        optionError ??= 'invalid option key; expected a single uppercase letter';
        continue;
      }
      const key = option[1];
      if (keys.has(key)) optionError ??= `duplicate option key ${key}`;
      keys.add(key);
      const pick = option[2].includes('[pick]');
      const value = option[2].replace(/\[pick\]/g, '');
      const separator = value.indexOf('|');
      options.push({
        key,
        text: (separator < 0 ? value : value.slice(0, separator)).trim(),
        ...(separator < 0 ? {} : { detail: value.slice(separator + 1).trim() }),
        pick,
      });
      continue;
    }
    const field = trimmed.match(/^([^:]+):\s*(.*)$/);
    if (!field) continue;
    const key = field[1].trim();
    if (key === 'label' || key === questionField || key === 'quote' || key === 'context') {
      fields.set(key, field[2].trim());
    } else {
      notices.push(`unknown field ${key} ignored`);
    }
  }
  const question = fields.get(questionField);
  if (!question) {
    warn(`missing ${questionField}`);
    return undefined;
  }
  const reason = optionError ?? (kind === 'decision' && options.length < 2 ? 'expected at least 2 options'
      : options.filter((option) => option.pick).length > 1 ? 'at most one option may have [pick]'
        : undefined);
  if (reason) {
    warn(reason);
    return undefined;
  }
  if (hasAssumptionOptions) notices.push('assumption option lines ignored');
  for (const notice of notices) warn(notice);
  const humanized = id.replace(/-/g, ' ');
  const item: ReviewItem = {
    id,
    kind,
    label: fields.get('label') || humanized.charAt(0).toUpperCase() + humanized.slice(1),
    question,
    ...(fields.get('context') ? { context: fields.get('context')! } : {}),
    ...(fields.get('quote') ? { quote: fields.get('quote')! } : {}),
    ...(kind === 'decision' ? { options } : {}),
    sectionId,
    hash: '',
  };
  item.hash = hashItem(item);
  return item;
}
