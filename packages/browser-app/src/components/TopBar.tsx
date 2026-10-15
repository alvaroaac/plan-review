import { useReview } from '../state/ReviewContext.js';
import { vscodeTheme } from '../theme.js';
import { MoonIcon, SunIcon } from './icons.js';
import { Stepper } from './Stepper.js';

export function TopBar() {
  const { state, dispatch } = useReview();
  const { theme, submitOpen } = state.ui;
  const showThemeToggle = vscodeTheme() === null;

  return (
    <header class="top">
      <div class="brand"><span class="logo" aria-hidden="true" />plan-review</div>
      <span class="crumb"><b>{state.doc.title}</b></span>
      <div class="sp" />
      {state.items.length > 0 && <><Stepper /><div class="sp" /></>}
      {showThemeToggle && (
        <button
          type="button"
          class="icon-btn"
          title="Toggle theme"
          aria-label="Toggle theme"
          onClick={() => dispatch({ type: 'toggleTheme' })}
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
      )}
      <button
        type="button"
        class="btn primary"
        aria-expanded={submitOpen}
        onClick={() => dispatch({ type: submitOpen ? 'closeSubmit' : 'openSubmit' })}
      >
        Submit review
      </button>
    </header>
  );
}
