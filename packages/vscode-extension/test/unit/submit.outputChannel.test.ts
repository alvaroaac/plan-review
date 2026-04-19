import { describe, it, expect, vi, beforeEach } from 'vitest';

const { createOutputChannel, show, append } = vi.hoisted(() => {
  const show = vi.fn();
  const append = vi.fn();
  const createOutputChannel = vi.fn();
  createOutputChannel.mockReturnValue({ append, show });
  return { createOutputChannel, show, append };
});

vi.mock('vscode', () => ({
  window: { createOutputChannel },
}));

// Import AFTER the mock is set up
import { submitToOutputChannel, __resetChannel } from '../../src/submit/outputChannel.js';

beforeEach(() => { __resetChannel(); vi.clearAllMocks(); createOutputChannel.mockReturnValue({ append, show }); });

describe('submitToOutputChannel', () => {
  it('lazily creates and reuses a single channel', async () => {
    await submitToOutputChannel('line1');
    await submitToOutputChannel('line2');
    expect(createOutputChannel).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith('line1\n\n');
    expect(append).toHaveBeenCalledWith('line2\n\n');
    expect(show).toHaveBeenCalled();
  });
});
