import { describe, it, expect } from 'vitest';
import { HttpTransport } from '../src/transport.js';
import { parse, formatReview } from '@plan-review/core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PlanDocument, ReviewComment } from '@plan-review/core';
import type { ReviewSubmission } from '../src/transport.js';

const fixtureDir = resolve(import.meta.dirname, 'fixtures');

describe('browser review integration', () => {
  it('full flow: parse → transport → submit → format', async () => {
    const input = readFileSync(resolve(fixtureDir, 'plan-document.md'), 'utf-8');
    const doc = parse(input);

    const transport = new HttpTransport();
    transport.sendDocument(doc);

    const reviewPromise = new Promise<ReviewSubmission>((resolve) => {
      transport.onReviewSubmit(resolve);
    });

    const { url } = await transport.start(0);
    expect(url).toMatch(/^http:\/\/localhost:\d+/);

    // Simulate browser: fetch doc
    const docRes = await fetch(`${url}/api/doc`);
    const docData = await docRes.json();
    expect(docData.document.title).toBe('Feature X — Implementation Plan');
    expect(docData.document.mode).toBe('plan');

    // Simulate browser: submit review
    const comments: ReviewComment[] = [
      { sectionId: '1.1', text: 'Schema looks good', timestamp: new Date() },
      { sectionId: '2.1', text: 'Need more detail on processor', timestamp: new Date() },
    ];
    const submitRes = await fetch(`${url}/api/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comments, verdict: 'approved', summary: 'Ready to merge.' }),
    });
    expect(submitRes.status).toBe(200);

    // CLI receives comments
    const received = await reviewPromise;
    expect(received.comments).toHaveLength(2);
    expect(received.verdict).toBe('approved');
    expect(received.summary).toBe('Ready to merge.');

    // Merge and format
    doc.comments = received.comments;
    const formatReviewWithMeta = formatReview as (
      doc: PlanDocument,
      opts: Pick<ReviewSubmission, 'verdict' | 'summary'>,
    ) => string;
    const output = formatReviewWithMeta(doc, {
      verdict: received.verdict,
      summary: received.summary,
    });
    expect(output).toContain('Schema looks good');
    expect(output).toContain('Need more detail on processor');
    expect(output).toContain('**Sections reviewed:** 2/4');

    await transport.stop();
  });

  it('GET / serves HTML page', async () => {
    const doc = parse('# Test\n\n## Section\n\nContent');
    const transport = new HttpTransport();
    transport.sendDocument(doc);
    const { url } = await transport.start(0);

    const res = await fetch(`${url}/`);
    const html = await res.text();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<div id="app">');

    await transport.stop();
  });
});
