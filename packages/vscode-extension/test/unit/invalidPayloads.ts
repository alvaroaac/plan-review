import { answer, thread } from './reviewFixtures.js';

export const invalidProgress: [string, unknown][] = [
  ...[null, [], 'bad', 1, undefined].map((value): [string, unknown] => [`answers ${String(value)}`, { answers: value, threads: [] }]),
  ...Object.keys(answer).flatMap((key): [string, unknown][] => {
    const missing = { ...answer } as Record<string, unknown>;
    delete missing[key];
    return [[`answer missing ${key}`, { answers: { storage: missing }, threads: [] }], [`answer wrong ${key}`, { answers: { storage: { ...answer, [key]: key === 'round' ? '1' : 1 } }, threads: [] }]];
  }),
  ...Object.keys(thread('s')).map((key): [string, unknown] => {
    const missing = { ...thread('s') } as Record<string, unknown>;
    delete missing[key];
    return [`thread missing ${key}`, { answers: {}, threads: [missing] }];
  }),
  ...Object.keys(thread('s')).map((key): [string, unknown] => [`thread wrong ${key}`, { answers: {}, threads: [{ ...thread('s'), [key]: key === 'createdRound' ? '1' : 1 }] }]),
  ...['id', 'author', 'body', 'createdAt'].flatMap((key): [string, unknown][] => {
    const comment = { ...thread('s').comments[0] } as Record<string, unknown>;
    delete comment[key];
    return [[`comment missing ${key}`, { answers: {}, threads: [{ ...thread('s'), comments: [comment] }] }], [`comment wrong ${key}`, { answers: {}, threads: [{ ...thread('s'), comments: [{ ...thread('s').comments[0], [key]: 1 }] }] }]];
  }),
  ['invalid comment author', { answers: {}, threads: [{ ...thread('s'), comments: [{ ...thread('s').comments[0], author: 'user' }] }] }],
  ...[{}, { type: 'other', startLine: 0, endLine: 0, lineTexts: [] }, { type: 'lines', startLine: '0', endLine: 0, lineTexts: [] }, { type: 'lines', startLine: 0, endLine: '0', lineTexts: [] }, { type: 'lines', startLine: 0, endLine: 0, lineTexts: [1] }].map((anchor): [string, unknown] => [`invalid anchor ${JSON.stringify(anchor)}`, { answers: {}, threads: [{ ...thread('s'), anchor }] }]),
];
export const invalidSubmits = [null, [], {}, { verdict: null, summary: '' }, { verdict: 'rejected', summary: '' }, { verdict: 'approved', summary: 1 }, { verdict: 'approved' }];

