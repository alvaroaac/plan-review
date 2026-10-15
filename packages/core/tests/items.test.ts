import { readFileSync } from 'node:fs';
import { marked } from 'marked';
import { describe, it, expect, vi } from 'vitest';
import * as core from '../src/index.js';
import { extractItems, ITEM_FENCE_RE } from '../src/items.js';
import type { AgentReply, ExtractResult } from '../src/items.js';
import { hashItem } from '../src/reviewModel.js';
import type { PlanDocument } from '../src/types.js';

function makeDoc(...bodies: string[]): PlanDocument {
  return {
    title: 'Test Plan',
    metadata: { Author: 'Agent' },
    mode: 'generic',
    sections: bodies.map((body, i) => ({
      id: `section-${i + 1}`, heading: `Section ${i + 1}`, level: 2, body,
    })),
    comments: [],
  };
}

function fence(info: string, body: string): string {
  return `\`\`\`${info}\n${body}\n\`\`\``;
}

function decision(id = 'retry-backoff'): string {
  return fence(`decision id=${id}`, 'question: Which backoff?\n- A: Fixed\n- B: Exponential');
}

function expectMalformed(block: string, location: string, reason: RegExp): void {
  const doc = makeDoc(block);
  const result = extractItems(doc);
  expect(result.items).toEqual([]);
  expect(result.doc.sections[0].body).toBe(block);
  expect(result.warnings).toHaveLength(1);
  expect(result.warnings[0]).toContain(location);
  expect(result.warnings[0]).toMatch(reason);
}

describe('extractItems', () => {
  it('parses decision fields, trims values and strips picks from text and detail', () => {
    const result = extractItems(makeDoc(fence('decision id=retry-backoff', [
      'label:  Retry policy  ',
      'question:  Which backoff?  ',
      'quote:  retries back off  ',
      'context:  Last incident  ',
      '- A:  Fixed [pick]  |  Simple  ',
      '- B:  Exponential  |  Capped at 5 s  ',
      '- C:  No retries  ',
    ].join('\n'))));

    expect(result.warnings).toEqual([]);
    expect(result.items).toEqual([{
      id: 'retry-backoff', kind: 'decision', label: 'Retry policy',
      question: 'Which backoff?', quote: 'retries back off', context: 'Last incident',
      options: [
        { key: 'A', text: 'Fixed', detail: 'Simple', pick: true },
        { key: 'B', text: 'Exponential', detail: 'Capped at 5 s', pick: false },
        { key: 'C', text: 'No retries', pick: false },
      ],
      sectionId: 'section-1', hash: expect.any(String),
    }]);
  });

  it('recognizes a pick in option detail', () => {
    const result = extractItems(makeDoc(fence('decision id=backoff',
      'question: Which?\n- A: Fixed | Simple [pick]\n- B: Exponential')));
    expect(result.items[0].options?.[0]).toEqual({
      key: 'A', text: 'Fixed', detail: 'Simple', pick: true,
    });
    expect(result.warnings).toEqual([]);
  });

  it('parses assumptions using statement as question, without options', () => {
    const result = extractItems(makeDoc(fence('assumption id=crypto-support',
      'label:  Browser crypto  \nstatement:  SubtleCrypto exists.  \nquote:  SubtleCrypto  \ncontext:  Browserslist  ')));
    expect(result.items).toEqual([{
      id: 'crypto-support', kind: 'assumption', label: 'Browser crypto',
      question: 'SubtleCrypto exists.', quote: 'SubtleCrypto', context: 'Browserslist',
      sectionId: 'section-1', hash: expect.any(String),
    }]);
    expect(result.warnings).toEqual([]);
  });

  it('warns and ignores option lines in an otherwise valid assumption', () => {
    const result = extractItems(makeDoc(fence('assumption id=crypto-support',
      'statement: SubtleCrypto exists.\n- a: Ignored [pick]\n- AA: Also ignored [pick]')));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).not.toHaveProperty('options');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('crypto-support');
    expect(result.warnings[0]).toMatch(/option.*ignor/i);
  });

  it('defaults missing labels to humanized ids', () => {
    const result = extractItems(makeDoc(decision(), fence('assumption id=browser-crypto', 'statement: Supported.')));
    expect(result.items.map((item) => item.label)).toEqual(['Retry backoff', 'Browser crypto']);
  });

  it('assigns section ids and hashes in document order across sections', () => {
    const result = extractItems(makeDoc(
      `${decision('z-first')}\n\n${fence('assumption id=a-second', 'statement: Supported.')}`,
      decision('m-third'),
    ));
    expect(result.items.map((item) => [item.id, item.sectionId])).toEqual([
      ['z-first', 'section-1'], ['a-second', 'section-1'], ['m-third', 'section-2'],
    ]);
    for (const item of result.items) expect(item.hash).toBe(hashItem(item));
  });

  it('only considers top-level fenced code with exact type words', () => {
    const nested = decision('nested').split('\n').map((line) => `> ${line}`).join('\n');
    const list = `- Example:\n\n${decision('listed').split('\n').map((line) => `  ${line}`).join('\n')}`;
    const indented = decision('indented').split('\n').map((line) => `    ${line}`).join('\n');
    const body = [
      nested, list, indented,
      fence('javascript', 'const value = 1;'),
      fence('decisions id=plural', 'question: Ignored'),
      fence('assumption-extra id=suffix', 'statement: Ignored'),
      fence('reply-extra thread=t_ignored', 'Ignored'),
      fence('Decision id=capital', 'question: Ignored'),
      fence('text decision id=late', 'question: Ignored'),
      `\`\`\`\`text\n${decision('embedded')}\n\`\`\`\``,
      decision('top-level'),
    ].join('\n\n');
    const result = extractItems(makeDoc(body));
    expect(result.items.map((item) => item.id)).toEqual(['top-level']);
    expect(result.replies).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.doc.sections[0].body).toBe(body);
  });

  it('recognizes tilde fences and whitespace-separated info attributes', () => {
    const result = extractItems(makeDoc('~~~decision\tid=tilde\nquestion: Which?\n- A: First\n- B: Second\n~~~'));
    expect(result.items.map((item) => item.id)).toEqual(['tilde']);
    expect(result.warnings).toEqual([]);
  });

  it('rejects a missing id with the block line number', () => {
    expectMalformed(`Introduction\n\n${fence('decision', 'question: Which?\n- A: First\n- B: Second')}`,
      'line 3', /missing.*id/i);
  });

  it('rejects bad id characters', () => {
    expectMalformed(decision('Bad_id'), 'Bad_id', /invalid.*id|id.*invalid/i);
  });

  it('rejects a missing question', () => {
    expectMalformed(fence('decision id=no-question', '- A: First\n- B: Second'), 'no-question', /missing.*question/i);
  });

  it('rejects a missing statement', () => {
    expectMalformed(fence('assumption id=no-statement', 'label: No statement'), 'no-statement', /missing.*statement/i);
  });

  it('rejects an empty question', () => {
    expectMalformed(fence('decision id=empty-question', 'question:   \n- A: First\n- B: Second'),
      'empty-question', /missing.*question/i);
  });

  it('rejects an empty statement', () => {
    expectMalformed(fence('assumption id=empty-statement', 'statement:   '), 'empty-statement', /missing.*statement/i);
  });

  it('rejects fewer than two options', () => {
    expectMalformed(fence('decision id=one-option', 'question: Which?\n- A: First'), 'one-option', /at least.*2.*option/i);
  });

  it('rejects duplicate option keys', () => {
    expectMalformed(fence('decision id=duplicate-key', 'question: Which?\n- A: First\n- A: Second'),
      'duplicate-key', /duplicate.*key/i);
  });

  it('rejects more than one picked option', () => {
    expectMalformed(fence('decision id=two-picks', 'question: Which?\n- A: First [pick]\n- B: Second | Detail [pick]'),
      'two-picks', /more than one.*pick|at most one.*pick/i);
  });

  it('rejects a lowercase option key even with two valid options', () => {
    expectMalformed(fence('decision id=lowercase', 'question: Which?\n- A: First\n- B: Second\n- c: Third'),
      'lowercase', /option.*key/i);
  });

  it('rejects a multi-letter option key even with two valid options', () => {
    expectMalformed(fence('decision id=multi-letter', 'question: Which?\n- A: First\n- B: Second\n- AA: Third'),
      'multi-letter', /option.*key/i);
  });

  it('rejects duplicate ids across the plan, keeping the first occurrence', () => {
    const second = fence('assumption id=shared-id', 'statement: Duplicate.');
    const result = extractItems(makeDoc(decision('shared-id'), second));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: 'shared-id', kind: 'decision', sectionId: 'section-1' });
    expect(result.doc.sections[1].body).toBe(second);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('shared-id');
    expect(result.warnings[0]).toMatch(/duplicate.*id/i);
  });

  it('warns about unknown fields and still returns the valid item', () => {
    const result = extractItems(makeDoc(fence('decision id=unknown-field',
      'question: Which?\npriority: high\n- A: First\n- B: Second')));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).not.toHaveProperty('priority');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('unknown-field');
    expect(result.warnings[0]).toMatch(/unknown.*priority/i);
  });

  it('emits one warning for a malformed block even with unknown fields', () => {
    expectMalformed(fence('decision id=malformed', 'priority: high\n- A: First'), 'malformed', /missing.*question/i);
  });

  it('removes exactly reply token.raw and returns trimmed multiline replies in order', () => {
    const first = fence('reply thread=t_first', '\n  First line.\nSecond line.  \n');
    const second = fence('reply thread=t_second', '  Another reply.  ');
    const body = `Before  \n\n${first}\n\nBetween\n\n${second}\n\nAfter  `;
    const rawReplies = marked.lexer(body).filter((token) => token.type === 'code').map((token) => token.raw);
    const expectedBody = rawReplies.reduce((text, raw) => text.replace(raw, ''), body);
    const result: ExtractResult = extractItems(makeDoc(body, fence('reply thread=t_third', ' Third. ')));
    const replies: AgentReply[] = [
      { threadId: 't_first', body: 'First line.\nSecond line.', sectionId: 'section-1' },
      { threadId: 't_second', body: 'Another reply.', sectionId: 'section-1' },
      { threadId: 't_third', body: 'Third.', sectionId: 'section-2' },
    ];
    expect(result.replies).toEqual(replies);
    expect(result.doc.sections[0].body).toBe(expectedBody);
    expect(result.warnings).toEqual([]);
  });

  it('removes a reply with missing thread and warns with its line number', () => {
    const block = fence('reply', 'No thread.');
    const result = extractItems(makeDoc(`Before\n\n${block}\n\nAfter`));
    expect(result.doc.sections[0].body).toBe('Before\n\n\n\nAfter');
    expect(result.replies).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('line 3');
    expect(result.warnings[0]).toMatch(/missing.*thread/i);
  });

  it('removes a reply with an empty thread attribute and warns', () => {
    const result = extractItems(makeDoc(fence('reply thread=', 'No thread.')));
    expect(result.doc.sections[0].body).toBe('');
    expect(result.replies).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/missing.*thread/i);
  });

  it('does not remove identical reply text inside a nested fence', () => {
    const reply = fence('reply thread=t_example', 'Example.');
    const nested = `\`\`\`\`text\n${reply}\n\`\`\`\``;
    const result = extractItems(makeDoc(`${nested}\n\n${reply}\n\nAfter`));
    expect(result.doc.sections[0].body).toBe(`${nested}\n\n\n\nAfter`);
    expect(result.replies).toHaveLength(1);
  });

  it('preserves CRLF bytes outside removed replies', () => {
    const body = `Before\n\n${decision()}\n\n${fence('reply thread=t_crlf', 'Reply.')}\n\nAfter`.replace(/\n/g, '\r\n');
    const result = extractItems(makeDoc(body));
    expect(result.doc.sections[0].body).toBe(`Before\n\n${decision()}\n\n\n\nAfter`.replace(/\n/g, '\r\n'));
    expect(result.items).toHaveLength(1);
    expect(result.replies).toEqual([{ threadId: 't_crlf', body: 'Reply.', sectionId: 'section-1' }]);
  });

  it('keeps item fences in section bodies', () => {
    const body = `${decision()}\n\n${fence('assumption id=support', 'statement: Supported.')}`;
    const result = extractItems(makeDoc(body));
    expect(result.items).toHaveLength(2);
    expect(result.doc.sections[0].body).toBe(body);
  });

  it('does not mutate the input document or its sections', () => {
    const doc = makeDoc(`${decision()}\n\n${fence('reply thread=t_reply', 'Reply.')}`);
    const before = structuredClone(doc);
    Object.freeze(doc.sections[0]);
    Object.freeze(doc.sections);
    Object.freeze(doc);
    const result = extractItems(doc);
    expect(doc).toEqual(before);
    expect(result.doc).not.toBe(doc);
    expect(result.doc.sections).not.toBe(doc.sections);
    expect(result.doc.sections[0].body).not.toBe(doc.sections[0].body);
    expect(result.doc).toEqual({ ...before, sections: [{ ...before.sections[0], body: `${decision()}\n\n` }] });
  });

  it('handles a document without sections', () => {
    const doc = makeDoc();
    expect(extractItems(doc)).toEqual({ doc, items: [], replies: [], warnings: [] });
  });
});

describe('items public API', () => {
  it('matches item info strings and excludes other fence types', () => {
    for (const info of ['decision id=retry-backoff', 'assumption id=browser-crypto', 'decision\tid=retry']) {
      expect(ITEM_FENCE_RE.test(info)).toBe(true);
      expect(ITEM_FENCE_RE.test(info)).toBe(true);
    }
    for (const info of ['reply thread=t_reply', 'decisions id=retry', 'assumption-extra id=retry',
      'text decision id=retry', 'Decision id=retry', 'decision', 'decision id=']) {
      expect(ITEM_FENCE_RE.test(info)).toBe(false);
    }
  });

  it('re-exports items through the root entry and exposes the typed items subpath', () => {
    expect(core.extractItems).toBe(extractItems);
    expect(core.ITEM_FENCE_RE).toBe(ITEM_FENCE_RE);
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(pkg.exports['./items']).toEqual({ types: './dist/items.d.ts', default: './dist/items.js' });
  });

  it('keeps items browser-safe', () => {
    const source = readFileSync(new URL('../src/items.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/node:/);
  });
});


describe('item extraction regressions', () => {
  it('skips an empty reply body and warns with its line number', () => {
    const result = extractItems(makeDoc(`Before\n\n${fence('reply thread=t_empty', '  \n  ')}\n\nAfter`));
    expect(result.replies).toEqual([]);
    expect(result.warnings).toEqual(['Reply at line 3: empty body']);
    expect(result.doc.sections[0].body).toBe('Before\n\n\n\nAfter');
  });

  it('uses a private lexer independent of the global marked singleton', () => {
    const tokens = marked.lexer('');
    const lexer = vi.spyOn(marked, 'lexer').mockReturnValue(tokens);
    try {
      expect(extractItems(makeDoc(decision())).items).toHaveLength(1);
      expect(lexer).not.toHaveBeenCalled();
    } finally {
      lexer.mockRestore();
    }
  });

  it.each(['label', 'quote', 'context'])('treats an empty %s field as absent', (field) => {
    const plain = extractItems(makeDoc(fence('assumption id=browser-crypto', 'statement: Supported.')));
    const empty = extractItems(makeDoc(fence('assumption id=browser-crypto', `statement: Supported.\n${field}:   `)));
    expect(empty.items).toEqual(plain.items);
    expect(empty.warnings).toEqual([]);
  });
});
