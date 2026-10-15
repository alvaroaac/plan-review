import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { LoadedReview } from '@plan-review/core';
import type { ReviewClient } from '@plan-review/core/client';
import { ReviewProvider, useReview } from './state/ReviewContext.js';
import { TopBar } from './components/TopBar.js';
import { TocPanel } from './components/TocPanel.js';
import { DocView } from './components/DocView.js';
import { Rail } from './components/Rail.js';
import { SubmitFailureView, SubmittedView } from './components/SubmitResult.js';
import { useScrollSpy } from './scroll.js';
import { useHeartbeat } from './heartbeat.js';
import { applyTheme, detectTheme } from './theme.js';

export function App({ client }: { client: ReviewClient }) {
  const [theme] = useState(detectTheme);
  const [loaded, setLoaded] = useState<LoadedReview | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Theme the loading and error screens too; the provider owns it once loaded.
  useLayoutEffect(() => applyTheme(theme), [theme]);

  const load = useCallback(() => {
    setError(null);
    client
      .loadDocument()
      .then(setLoaded)
      .catch((err: Error) => setError(err.message));
  }, [client]);
  useEffect(load, [load]);

  if (error) {
    return (
      <div class="loading">
        Error: {error}
        <button type="button" class="btn" onClick={load}>Retry</button>
      </div>
    );
  }
  if (!loaded) return <div class="loading">Loading...</div>;

  return (
    <ReviewProvider client={client} loaded={loaded} theme={theme}>
      <ReviewShell />
    </ReviewProvider>
  );
}

function ReviewShell() {
  const { state } = useReview();
  const { submitted, submitError } = state.ui;
  // Stays on through a failed submit: the server waits for the retry.
  useHeartbeat(submitted === null);

  if (submitted) return <SubmittedView />;
  if (submitError) return <SubmitFailureView message={submitError.message} request={submitError.request} />;
  return <ReviewLayout />;
}

function ReviewLayout() {
  const { state } = useReview();
  const scrollRef = useRef<HTMLDivElement>(null);
  const active = useScrollSpy(scrollRef, state.doc.sections.map((s) => s.id));

  return (
    <div class="app">
      <TopBar />
      <div class="main">
        <TocPanel active={active} />
        <div class="scroll" ref={scrollRef}>
          <DocView />
        </div>
        <Rail />
      </div>
    </div>
  );
}
