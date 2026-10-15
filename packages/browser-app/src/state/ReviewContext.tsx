import { createContext, type ComponentChildren } from 'preact';
import {
  useCallback, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef,
} from 'preact/hooks';
import type { LoadedReview, ProgressUpdate, ReviewItem } from '@plan-review/core';
import type { ReviewClient } from '@plan-review/core/client';
import { createAutosave } from '@plan-review/core/autosave';
import { applyTheme, storeTheme, vscodeTheme, type Theme } from '../theme.js';
import {
  initReviewState, isProgressAction, reviewReducer, type ReviewAction, type ReviewState,
} from './reducer.js';

interface ReviewContextValue {
  state: ReviewState;
  dispatch: (action: ReviewAction) => void;
  client: ReviewClient;
  /** Sends any pending progress save now; rejects if the latest progress could not be saved. */
  flushAutosave: () => Promise<void>;
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

  // `progress` is the rendered answers and threads; `synced` is what the server is known
  // to hold (as loaded, reloaded or last saved). A save is owed whenever they differ.
  const { answers, threads } = state.review;
  const progress = useRef<ProgressUpdate>({ answers, threads });
  progress.current = { answers, threads };
  const synced = useRef<ProgressUpdate>(progress.current);

  // While a host reload runs, progress edits wait and are replayed on the new round,
  // so no pre-reload snapshot can be saved over it. A held answer keeps the hash of the
  // item the reviewer saw, so a revised item still shows as changed.
  const items = useRef(state.items);
  items.current = state.items;
  const held = useRef<ReviewAction[] | null>(null);
  const dispatch = useCallback((action: ReviewAction) => {
    if (held.current && isProgressAction(action)) {
      held.current.push(pinItemHash(action, items.current));
      return;
    }
    // A reload is the server's truth: never echo it back as a save.
    if (action.type === 'reload') synced.current = progressOf(action.loaded.review);
    rawDispatch(action);
  }, []);

  // Background saves are best-effort (the next change retries with the full state),
  // but the last failure is kept so a submit never goes out over unsaved progress.
  const saveError = useRef<unknown>(null);
  const autosave = useMemo(
    () => createAutosave<ProgressUpdate>({
      delayMs: 500,
      save: async (update) => {
        await client.saveProgress(update);
        synced.current = update;
        saveError.current = null;
      },
      onError: (err) => { saveError.current = err; },
    }),
    [client],
  );

  useEffect(() => {
    if (isUnsaved(progress.current, synced.current)) autosave.schedule(progress.current);
  }, [autosave, answers, threads]);

  const flushAutosave = useCallback(async () => {
    if (isUnsaved(progress.current, synced.current)) autosave.schedule(progress.current);
    await autosave.flush();
    if (saveError.current) throw saveError.current;
  }, [autosave]);

  // A tab can close before the autosave effect has run, so compare the rendered progress
  // itself and send it past the debounce queue, with keepalive so it outlives the page.
  useEffect(() => {
    const saveOnUnload = () => {
      if (!isUnsaved(progress.current, synced.current)) return;
      autosave.cancel();
      synced.current = progress.current;
      void client.saveProgress(progress.current, { keepalive: true }).catch(() => {});
    };
    window.addEventListener('beforeunload', saveOnUnload);
    return () => {
      window.removeEventListener('beforeunload', saveOnUnload);
      void autosave.flush();
    };
  }, [client, autosave]);

  // The VS Code host broadcasts `planChanged` when the plan file is saved; it has
  // already re-opened the review, so save what we have and load the new round.
  // If the save fails, the reload is skipped: it would replace unsaved local progress.
  const reloads = useRef(Promise.resolve());
  const reloadFromHost = useCallback(() => {
    reloads.current = reloads.current.then(async () => {
      held.current = [];
      try {
        await flushAutosave();
        dispatch({ type: 'reload', loaded: await client.loadDocument() });
      } catch {
        // Local progress stays as it is; the held edits still apply below.
      } finally {
        const actions = held.current;
        held.current = null;
        actions.forEach(rawDispatch);
      }
    });
  }, [client, flushAutosave, dispatch]);

  useHostPlanChanges(reloadFromHost);
  useThemeSync(state.ui.theme, dispatch);

  const value = useMemo(
    () => ({ state, dispatch, client, flushAutosave }),
    [state, dispatch, client, flushAutosave],
  );
  return <ReviewContext.Provider value={value}>{children}</ReviewContext.Provider>;
}

function pinItemHash(action: ReviewAction, items: ReviewItem[]): ReviewAction {
  if (action.type !== 'answer' && action.type !== 'defer') return action;
  return { ...action, itemHash: items.find((item) => item.id === action.itemId)?.hash };
}

function progressOf({ answers, threads }: ProgressUpdate): ProgressUpdate {
  return { answers, threads };
}

// The reducer returns new objects for every change, so identity tells saved from unsaved.
function isUnsaved(progress: ProgressUpdate, synced: ProgressUpdate): boolean {
  return progress.answers !== synced.answers || progress.threads !== synced.threads;
}

function useHostPlanChanges(onPlanChanged: () => void) {
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (ev.data?.kind === 'event' && ev.data?.type === 'planChanged') onPlanChanged();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onPlanChanged]);
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
