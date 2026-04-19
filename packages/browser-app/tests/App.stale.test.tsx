import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { FakeReviewClient } from '@plan-review/core';
import type { PlanDocument } from '@plan-review/core';
import { App } from '../src/App.js';

const doc: PlanDocument = {
  title: 'Test Plan',
  metadata: {},
  mode: 'generic',
  sections: [{ id: 's1', heading: 'Intro', level: 2, body: 'body' }],
  comments: [],
};

describe('App stale banner', () => {
  it('shows stale banner when restoredSession.stale is true', async () => {
    const client = new FakeReviewClient({ document: doc });
    // Patch loadDocument once to include a stale restored session
    client.loadDocument = async () => ({
      document: doc,
      restoredSession: { comments: [], activeSection: null, stale: true },
    });
    render(<App client={client} />);
    const banner = await screen.findByText(/plan has changed/i);
    expect(banner).toBeTruthy();
  });

  it('does not show banner when restoredSession is missing', async () => {
    const client = new FakeReviewClient({ document: doc });
    render(<App client={client} />);
    await screen.findByText(/Test Plan/i); // wait for render
    expect(screen.queryByText(/plan has changed/i)).toBeNull();
  });
});
