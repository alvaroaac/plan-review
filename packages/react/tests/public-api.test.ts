import { describe, it, expect } from 'vitest';
import * as react from '../src/index.js';

describe('@plan-review/react public API', () => {
  it('exports autosave hooks', () => {
    expect(react.useAutosave).toEqual(expect.any(Function));
    expect(react.useAutosaveSnapshot).toEqual(expect.any(Function));
    expect(react.useFlushOnUnload).toEqual(expect.any(Function));
  });
});
