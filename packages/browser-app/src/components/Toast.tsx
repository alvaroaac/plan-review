import { useEffect, useState } from 'preact/hooks';
import { CheckIcon } from './icons.js';

const TOAST_MS = 3200;

/** A short confirmation pinned to the bottom of the window; hides itself after 3.2 s. */
export function Toast({ message }: { message: string }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), TOAST_MS);
    return () => clearTimeout(timer);
  }, []);
  if (!visible) return null;
  return <div class="toast" role="status"><CheckIcon />{message}</div>;
}
