import { useEffect } from 'preact/hooks';

/**
 * Keeps the CLI server's tab-close watchdog informed while `active`:
 * - POST /api/heartbeat every 5 s while the tab is visible, and once on mount.
 * - On visibilitychange → hidden, POST /api/pause (Chrome throttles background-tab
 *   timers and would otherwise trigger a false cancel); → visible re-arms immediately.
 * - On beforeunload, sendBeacon('/api/cancel') so the server exits quickly on a clean close.
 * Disabled after submit — the server is already shutting down.
 */
export function useHeartbeat(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    const post = (path: string): void => {
      // Defensive against test envs where `fetch` may return undefined.
      try {
        const p = fetch(path, { method: 'POST', keepalive: true });
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch {
        // best-effort
      }
    };

    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') post('/api/heartbeat');
    }, 5_000);

    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') post('/api/heartbeat');
      else post('/api/pause');
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    const onBeforeUnload = (): void => {
      navigator.sendBeacon?.('/api/cancel');
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    post('/api/heartbeat');

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [active]);
}
