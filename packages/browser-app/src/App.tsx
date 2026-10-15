import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { LoadedReview } from '@plan-review/core';
import type { ReviewClient } from '@plan-review/core/client';
import { ReviewProvider, useReview } from './state/ReviewContext.js';
import { TopBar } from './components/TopBar.js';
import { TocPanel } from './components/TocPanel.js';
import { DocView } from './components/DocView.js';
import { Rail } from './components/Rail.js';
import { useScrollSpy } from './scroll.js';
import { useHeartbeat } from './heartbeat.js';
import { applyTheme, detectTheme } from './theme.js';

export function App({ client }: { client: ReviewClient }) {
  const [theme] = useState(detectTheme);
  const [loaded, setLoaded] = useState<LoadedReview | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Theme the loading and error screens too; the provider owns it once loaded.
  useLayoutEffect(() => applyTheme(theme), [theme]);

  useEffect(() => {
    client
      .loadDocument()
      .then(setLoaded)
      .catch((err: Error) => setError(err.message));
  }, [client]);

  if (error) return <div class="loading">Error: {error}</div>;
  if (!loaded) return <div class="loading">Loading...</div>;

  return (
    <ReviewProvider client={client} loaded={loaded} theme={theme}>
      <ReviewShell />
    </ReviewProvider>
  );
}

function ReviewShell() {
  const { state } = useReview();
  useHeartbeat(state.ui.submitted === null && state.ui.submitError === null);
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
