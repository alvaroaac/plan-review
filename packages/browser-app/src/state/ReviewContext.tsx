import { createContext, type ComponentChildren } from 'preact';
import {
  useCallback, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef,
} from 'preact/hooks';
import type { LoadedReview, ProgressUpdate } from '@plan-review/core';
import type { ReviewClient } from '@plan-review/core/client';
import { createAutosave } from '@plan-review/core/autosave';
import { applyTheme, storeTheme, vscodeTheme, type Theme } from '../theme.js';
import {
  initReviewState, isProgressAction, reviewReducer, type ReviewAction, type ReviewState,
} from './reducer.js';

interface ReviewContextValue {
  state: ReviewState;
  dispatch: (action: ReviewAction) => void;
}

const ReviewContext = createContext<ReviewContextValue | null>(null);

export function useReview(): ReviewContextValue {
  const value = useContext(ReviewContext);
  if (!value) throw new Error('useReview must be used inside <ReviewProvider>');
  return value;
}

interface ReviewProviderProps {
  client: ReviewClient;
  loaded: LoadedReview;
  theme: Theme;
  children: ComponentChildren;
}

export function ReviewProvider({ client, loaded, theme, children }: ReviewProviderProps) {
  const [state, rawDispatch] = useReducer(reviewReducer, undefined, () => initReviewState(loaded, theme));
  const progressChanged = useRef(false);

  const dispatch = useCallback((action: ReviewAction) => {
    // A reload is the server's truth: never echo it back as a save.
    if (action.type === 'reload') progressChanged.current = false;
    else if (isProgressAction(action)) progressChanged.current = true;
    rawDispatch(action);
  }, []);

  const autosave = useMemo(
    () => createAutosave<ProgressUpdate>({
      delayMs: 500,
      save: (update) => client.saveProgress(update),
      onError: () => {}, // best-effort; the next change retries with the full state
    }),
    [client],
  );

  const { answers, threads } = state.review;
  useEffect(() => {
    if (!progressChanged.current) return;
    progressChanged.current = false;
    autosave.schedule({ answers, threads });
  }, [autosave, answers, threads]);

  useEffect(() => {
    const flush = () => { void autosave.flush(); };
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, [autosave]);

  useHostPlanChanges(client, autosave.flush, dispatch);
  useThemeSync(state.ui.theme, dispatch);

  const value = useMemo(() => ({ state, dispatch }), [state, dispatch]);
  return <ReviewContext.Provider value={value}>{children}</ReviewContext.Provider>;
}

// The VS Code host broadcasts `planChanged` when the plan file is saved; it has
// already re-opened the review, so save what we have and load the new round.
function useHostPlanChanges(
  client: ReviewClient,
  flush: () => Promise<void>,
  dispatch: (action: ReviewAction) => void,
) {
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (ev.data?.kind !== 'event' || ev.data?.type !== 'planChanged') return;
      flush()
        .then(() => client.loadDocument())
        .then((loaded) => dispatch({ type: 'reload', loaded }))
        .catch(() => {});
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [client, flush, dispatch]);
}

// Applies the theme to <html>, remembers explicit toggles, and inside VS Code
// follows the editor's body class instead.
function useThemeSync(theme: Theme, dispatch: (action: ReviewAction) => void) {
  const firstRun = useRef(true);
  useLayoutEffect(() => {
    applyTheme(theme);
    if (!firstRun.current && !vscodeTheme()) storeTheme(theme);
    firstRun.current = false;
  }, [theme]);

  useEffect(() => {
    if (!vscodeTheme()) return;
    const followEditor = () => {
      const editorTheme = vscodeTheme();
      if (editorTheme && editorTheme !== theme) dispatch({ type: 'toggleTheme' });
    };
    followEditor(); // the class may have changed before this effect ran
    const observer = new MutationObserver(followEditor);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [theme, dispatch]);
}
