import { describe, it, expect } from 'vitest';
import { createMessageHandlers } from '../../src/messageHandlers.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const samplePlanPath = join(__dirname, '../fixtures/sample.md');

describe('messageHandlers.loadDocument', () => {
  it('parses the plan at the given URI and returns a PlanDocument', async () => {
    const handlers = createMessageHandlers();
    const result = await handlers.loadDocument({ planFsPath: samplePlanPath });
    expect(result.document.title).toBeTruthy();
    expect(Array.isArray(result.document.sections)).toBe(true);
    expect(typeof result.contentHash).toBe('string');
    expect(result.contentHash.startsWith('sha256:')).toBe(true);
  });
});
