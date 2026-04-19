import { render } from 'preact';
import type { ReviewClient } from '@plan-review/core';
import { App } from './App.js';
import { HttpReviewClient } from './httpClient.js';

declare global {
  interface Window {
    __REVIEW_CLIENT__?: ReviewClient;
  }
}

const client: ReviewClient = window.__REVIEW_CLIENT__ ?? new HttpReviewClient();
render(<App client={client} />, document.getElementById('app')!);
