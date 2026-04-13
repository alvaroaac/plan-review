import { describe, it, expect, vi } from 'vitest';
import { HttpTransport } from '../src/transport.js';
import type { PlanDocument, ReviewComment } from '../src/types.js';

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

    const received = new Promise<ReviewComment[]>((resolve) => {
      transport.onReviewSubmit(resolve);
    });

    const { url } = await transport.start(0);

    const comments: ReviewComment[] = [
      { sectionId: 'section-1', text: 'Nice', timestamp: new Date() },
    ];
    await fetch(`${url}/api/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comments }),
    });

    const result = await received;
    expect(result).toHaveLength(1);
    expect(result[0].sectionId).toBe('section-1');

    await transport.stop();
  });

  it('stop is safe to call multiple times', async () => {
    const transport = new HttpTransport();
    transport.sendDocument(mockDoc);
    await transport.start(0);
    await transport.stop();
    await transport.stop(); // should not throw
  });
});
