import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createAutosave } from '../src/autosave.js';

describe('createAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves a scheduled snapshot after the debounce delay', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const autosave = createAutosave<string>({ delayMs: 500, save });

    autosave.schedule('first');
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);

    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith('first');
  });

  it('coalesces multiple schedules and saves only the latest snapshot', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const autosave = createAutosave<string>({ delayMs: 500, save });

    autosave.schedule('first');
    await vi.advanceTimersByTimeAsync(250);
    autosave.schedule('second');
    await vi.advanceTimersByTimeAsync(499);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith('second');
  });

  it('flushes a pending snapshot immediately and resolves after save completes', async () => {
    let release!: () => void;
    const save = vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
      release = resolve;
    }));
    const autosave = createAutosave<string>({ delayMs: 500, save });

    autosave.schedule('pending');
    const flushed = autosave.flush();
    expect(save).toHaveBeenCalledWith('pending');

    let resolved = false;
    flushed.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    release();
    await flushed;
    expect(resolved).toBe(true);
  });

  it('flush resolves immediately when nothing is pending', async () => {
    const autosave = createAutosave<string>({ delayMs: 500, save: vi.fn() });
    await expect(autosave.flush()).resolves.toBeUndefined();
  });

  it('cancel drops the pending snapshot', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const autosave = createAutosave<string>({ delayMs: 500, save });

    autosave.schedule('pending');
    autosave.cancel();
    await vi.advanceTimersByTimeAsync(500);

    expect(save).not.toHaveBeenCalled();
  });

  it('flush resolves without saving after cancel drops the pending snapshot', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const autosave = createAutosave<string>({ delayMs: 500, save });

    autosave.schedule('pending');
    autosave.cancel();

    await expect(autosave.flush()).resolves.toBeUndefined();
    expect(save).not.toHaveBeenCalled();
  });

  it('routes save errors through onError and still resolves flush', async () => {
    const err = new Error('save failed');
    const onError = vi.fn();
    const autosave = createAutosave<string>({
      delayMs: 500,
      save: vi.fn().mockRejectedValue(err),
      onError,
    });

    autosave.schedule('pending');
    await expect(autosave.flush()).resolves.toBeUndefined();

    expect(onError).toHaveBeenCalledWith(err);
  });

  it('routes synchronous save errors through onError and still resolves flush', async () => {
    const err = new Error('sync save failed');
    const onError = vi.fn();
    const autosave = createAutosave<string>({
      delayMs: 500,
      save: vi.fn().mockImplementation(() => {
        throw err;
      }),
      onError,
    });

    autosave.schedule('pending');
    await expect(autosave.flush()).resolves.toBeUndefined();

    expect(onError).toHaveBeenCalledWith(err);
  });

  it('surfaces save errors asynchronously when onError is omitted', async () => {
    const err = new Error('save failed');
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const autosave = createAutosave<string>({
      delayMs: 500,
      save: vi.fn().mockRejectedValue(err),
    });

    autosave.schedule('pending');
    await autosave.flush();

    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 0);
  });

  it('surfaces synchronous save errors asynchronously when onError is omitted', async () => {
    const err = new Error('sync save failed');
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const autosave = createAutosave<string>({
      delayMs: 500,
      save: vi.fn().mockImplementation(() => {
        throw err;
      }),
    });

    autosave.schedule('pending');
    await expect(autosave.flush()).resolves.toBeUndefined();

    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 0);
  });

  it('flush waits for the latest overlapping in-flight save', async () => {
    const releases = new Map<string, () => void>();
    const save = vi.fn().mockImplementation((snapshot: string) => new Promise<void>((resolve) => {
      releases.set(snapshot, resolve);
    }));
    const autosave = createAutosave<string>({ delayMs: 500, save });

    autosave.schedule('first');
    const firstFlush = autosave.flush();
    expect(save).toHaveBeenCalledWith('first');

    autosave.schedule('second');
    const secondFlush = autosave.flush();
    expect(save).toHaveBeenCalledWith('second');

    releases.get('first')?.();
    await firstFlush;

    let resolved = false;
    const latestFlush = autosave.flush();
    latestFlush.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    releases.get('second')?.();
    await secondFlush;
    await latestFlush;
    expect(resolved).toBe(true);
  });
});
