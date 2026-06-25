// @vitest-environment jsdom

import React, { useCallback } from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAutosave, useAutosaveSnapshot, useFlushOnUnload } from '../src/index.js';

describe('@plan-review/react autosave hooks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a stable autosave instance when options are stable', () => {
    const seen: unknown[] = [];
    const save = vi.fn().mockResolvedValue(undefined);
    function Probe({ value }: { value: string }) {
      const stableSave = useCallback(save, []);
      seen.push(useAutosave({ delayMs: 500, save: stableSave }));
      return <div>{value}</div>;
    }

    const { rerender } = render(<Probe value="a" />);
    rerender(<Probe value="b" />);

    expect(seen[0]).toBe(seen[1]);
  });

  it('schedules snapshots and coalesces saves', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    function Probe({ snapshot }: { snapshot: string }) {
      const stableSave = useCallback(save, []);
      useAutosaveSnapshot(snapshot, { delayMs: 500, save: stableSave });
      return <div>{snapshot}</div>;
    }

    const { rerender } = render(<Probe snapshot="first" />);
    rerender(<Probe snapshot="second" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith('second');
  });

  it('does not schedule when disabled', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    function Probe() {
      const stableSave = useCallback(save, []);
      useAutosaveSnapshot('snapshot', { delayMs: 500, save: stableSave }, { enabled: false });
      return <div>disabled</div>;
    }

    render(<Probe />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(save).not.toHaveBeenCalled();
  });

  it('cancels a pending save when disabled before the delay elapses', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    function Probe({ enabled }: { enabled: boolean }) {
      const stableSave = useCallback(save, []);
      useAutosaveSnapshot('first', { delayMs: 500, save: stableSave }, { enabled });
      return <div>{enabled ? 'enabled' : 'disabled'}</div>;
    }

    const { rerender } = render(<Probe enabled={true} />);
    rerender(<Probe enabled={false} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(save).not.toHaveBeenCalled();
  });

  it('cancels pending saves on unmount', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    function Probe() {
      const stableSave = useCallback(save, []);
      useAutosaveSnapshot('snapshot', { delayMs: 500, save: stableSave });
      return <div>mounted</div>;
    }

    const { unmount } = render(<Probe />);
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(save).not.toHaveBeenCalled();
  });

  it('flushes on beforeunload and removes listener on unmount', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    function Probe() {
      const stableSave = useCallback(save, []);
      const autosave = useAutosaveSnapshot('snapshot', { delayMs: 500, save: stableSave });
      useFlushOnUnload(autosave);
      return <div>mounted</div>;
    }

    const { unmount } = render(<Probe />);
    window.dispatchEvent(new Event('beforeunload'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(save).toHaveBeenCalledOnce();

    unmount();
    window.dispatchEvent(new Event('beforeunload'));
    expect(save).toHaveBeenCalledOnce();
  });
});
