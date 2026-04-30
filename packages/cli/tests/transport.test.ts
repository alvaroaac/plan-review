import { describe, it, expect, vi } from 'vitest';
import { HttpTransport } from '../src/transport.js';
import type { PlanDocument, ReviewComment } from '@plan-review/core';
import type { ReviewSubmission } from '../src/transport.js';

const mockDoc: PlanDocument = {
  title: 'Test',
  metadata: {},
  mode: 'generic',
  sections: [{ id: 'section-1', heading: 'S1', level: 2, body: 'content' }],
  comments: [],
};

describe('HttpTransport', () => {
  it('starts server and returns url', async () => {
    const transport = new HttpTransport();
    transport.sendDocument(mockDoc);
    const { url } = await transport.start(0);
    expect(url).toMatch(/^http:\/\/localhost:\d+$/);
    await transport.stop();
  });

  it('throws if start called without document', async () => {
    const transport = new HttpTransport();
    await expect(transport.start(0)).rejects.toThrow('No document set');
  });

  it('serves document via GET /api/doc', async () => {
    const transport = new HttpTransport();
    transport.sendDocument(mockDoc);
    const { url } = await transport.start(0);

    const res = await fetch(`${url}/api/doc`);
    const data = await res.json();
    expect(data.document.title).toBe('Test');

    await transport.stop();
  });

  it('fires onReviewSubmit handler on POST /api/review', async () => {
    const transport = new HttpTransport();
    transport.sendDocument(mockDoc);

    const received = new Promise<ReviewSubmission>((resolve) => {
      transport.onReviewSubmit(resolve);
    });

    const { url } = await transport.start(0);

    const comments: ReviewComment[] = [
      { sectionId: 'section-1', text: 'Nice', timestamp: new Date() },
    ];
    await fetch(`${url}/api/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comments, verdict: 'approved', summary: 'Looks ready.' }),
    });

    const result = await received;
    expect(result.verdict).toBe('approved');
    expect(result.summary).toBe('Looks ready.');
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].sectionId).toBe('section-1');

    await transport.stop();
  });

  it('stop is safe to call multiple times', async () => {
    const transport = new HttpTransport();
    transport.sendDocument(mockDoc);
    await transport.start(0);
    await transport.stop();
    await transport.stop(); // should not throw
  });

  it('review promise rejects on timeout (simulated via short timeout)', async () => {
    const transport = new HttpTransport();
    transport.sendDocument(mockDoc);

    // Simulate the timeout pattern used in index.ts, but with 50ms
    const reviewPromise = new Promise<ReviewSubmission>((resolve, reject) => {
      transport.onReviewSubmit(resolve);
      setTimeout(() => reject(new Error('Browser review timed out')), 50);
    });

    await transport.start(0);

    await expect(reviewPromise).rejects.toThrow('Browser review timed out');
    await transport.stop();
  });

  it('review promise resolves before timeout if submission arrives', async () => {
    const transport = new HttpTransport();
    transport.sendDocument(mockDoc);

    const reviewPromise = new Promise<ReviewSubmission>((resolve, reject) => {
      transport.onReviewSubmit(resolve);
      setTimeout(() => reject(new Error('Browser review timed out')), 5000);
    });

    const { url } = await transport.start(0);

    const comments: ReviewComment[] = [
      { sectionId: 'section-1', text: 'Before timeout', timestamp: new Date() },
    ];
    await fetch(`${url}/api/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comments, verdict: null, summary: '' }),
    });

    const result = await reviewPromise;
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].text).toBe('Before timeout');

    await transport.stop();
  });

  it('POST /api/review rejects malformed comments', async () => {
    const transport = new HttpTransport();
    transport.sendDocument(mockDoc);
    const { url } = await transport.start(0);

    const res = await fetch(`${url}/api/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comments: [{ bad: 'shape' }], verdict: null, summary: '' }),
    });

    expect(res.status).toBe(400);
    await transport.stop();
  });

  it('stop cleans up even if no submission received', async () => {
    const transport = new HttpTransport();
    transport.sendDocument(mockDoc);
    await transport.start(0);
    // Just stop without any submission
    await transport.stop();
    // Should not throw or hang
  });
});
