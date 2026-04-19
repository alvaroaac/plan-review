import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PlanDocument } from '@plan-review/core';

// ---------------------------------------------------------------------------
// Mock node:fs so createReadStream doesn't actually open /dev/tty
// ---------------------------------------------------------------------------

vi.mock('node:fs', () => ({
  createReadStream: vi.fn(() => ({ on: vi.fn(), pipe: vi.fn() })),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Pure-function tests (findSection, getReviewableSections, printSummary)
// ---------------------------------------------------------------------------

// Import after vi.mock setup (static imports are hoisted by Vitest)
import { findSection, getReviewableSections, printSummary, navigate } from '../src/navigator.js';

function makePlanDoc(overrides: Partial<PlanDocument> = {}): PlanDocument {
  return {
    title: 'Test Plan',
    metadata: {},
    mode: 'plan',
    sections: [
      { id: 'milestone-1', heading: 'Foundation', level: 2, body: '' },
      { id: '1.1', heading: 'Create schema', level: 3, body: 'Body A', parent: 'milestone-1', dependencies: { dependsOn: [], blocks: ['1.2'] } },
      { id: '1.2', heading: 'Run migration', level: 3, body: 'Body B', parent: 'milestone-1', dependencies: { dependsOn: ['1.1'], blocks: [] } },
    ],
    comments: [],
    ...overrides,
  };
}

function makeGenericDoc(overrides: Partial<PlanDocument> = {}): PlanDocument {
  return {
    title: 'Generic Doc',
    metadata: {},
    mode: 'generic',
    sections: [
      { id: 'section-1', heading: 'Overview', level: 2, body: 'Intro' },
      { id: 'section-2', heading: 'Details', level: 2, body: 'More info' },
      { id: 'section-3', heading: 'Sub', level: 3, body: 'Sub content' },
    ],
    comments: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
describe('findSection', () => {
  it('finds section by exact ID', () => {
    const doc = makePlanDoc();
    const result = findSection(doc, '1.1');
    expect(result?.id).toBe('1.1');
  });

  it('finds section by numeric index (generic mode)', () => {
    const doc = makeGenericDoc();
    // In generic mode all sections with level >= 2 are reviewable
    // section-1 (level 2) is index 1, section-2 (level 2) is index 2, section-3 (level 3) is index 3
    const result = findSection(doc, '1');
    expect(result?.id).toBe('section-1');
  });

  it('returns undefined when section not found', () => {
    const doc = makePlanDoc();
    const result = findSection(doc, 'nonexistent');
    expect(result).toBeUndefined();
  });

  it('returns undefined for numeric index out of range', () => {
    const doc = makePlanDoc();
    const result = findSection(doc, '999');
    expect(result).toBeUndefined();
  });

  it('returns undefined for numeric index 0', () => {
    const doc = makePlanDoc();
    const result = findSection(doc, '0');
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe('getReviewableSections', () => {
  it('returns only level-3 sections in plan mode', () => {
    const doc = makePlanDoc();
    const sections = getReviewableSections(doc);
    expect(sections.every((s) => s.level === 3)).toBe(true);
    expect(sections).toHaveLength(2);
  });

  it('returns level >= 2 sections in generic mode', () => {
    const doc = makeGenericDoc();
    const sections = getReviewableSections(doc);
    expect(sections.every((s) => s.level >= 2)).toBe(true);
    expect(sections).toHaveLength(3); // sections 1, 2, 3 all have level >= 2
  });
});

// ---------------------------------------------------------------------------
describe('printSummary', () => {
  it('prints correct section counts and comment stats', () => {
    const messages: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      messages.push(String(args[0]));
    });
    const doc = makePlanDoc({
      comments: [{ sectionId: '1.1', text: 'Good', timestamp: new Date() }],
    });
    printSummary(doc);
    errorSpy.mockRestore();

    const combined = messages.join('\n');
    expect(combined).toContain('Sections: 2');
    expect(combined).toContain('Total comments: 1');
  });

  it('reports zero comments when none exist', () => {
    const messages: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      messages.push(String(args[0]));
    });
    const doc = makePlanDoc();
    printSummary(doc);
    errorSpy.mockRestore();

    const combined = messages.join('\n');
    expect(combined).toContain('Total comments: 0');
  });
});

// ---------------------------------------------------------------------------
// navigate() tests — mock readline to control user input
// ---------------------------------------------------------------------------

vi.mock('node:readline', () => {
  let questionCallback: ((answer: string) => void) | null = null;
  let callCount = 0;
  let responses: string[] = [];

  const rl = {
    question: vi.fn((prompt: string, cb: (answer: string) => void) => {
      questionCallback = cb;
      const response = responses[callCount] ?? '';
      callCount++;
      cb(response);
    }),
    close: vi.fn(),
    _reset: (newResponses: string[]) => {
      responses = newResponses;
      callCount = 0;
      questionCallback = null;
      rl.question.mockClear();
      rl.close.mockClear();
    },
  };

  return {
    createInterface: vi.fn(() => rl),
    _rl: rl,
  };
});

async function getReadlineMock() {
  const mod = await import('node:readline') as unknown as { _rl: { _reset: (r: string[]) => void; close: ReturnType<typeof vi.fn>; question: ReturnType<typeof vi.fn> } };
  return mod._rl;
}

describe('navigate', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("exits immediately when user types 'done'", async () => {
    const rl = await getReadlineMock();
    // First question is the main menu; respond 'done'
    rl._reset(['done']);
    const doc = makePlanDoc();
    const result = await navigate(doc, false);
    expect(result).toBe(doc);
    expect(rl.close).toHaveBeenCalled();
  });

  it("exits immediately when user types 'q'", async () => {
    const rl = await getReadlineMock();
    rl._reset(['q']);
    const doc = makePlanDoc();
    const result = await navigate(doc, false);
    expect(result).toBe(doc);
  });

  it("runs linear review with 'all' then skips with empty input — no comments added", async () => {
    const rl = await getReadlineMock();
    // main menu: 'all', then per-section (2 sections): skip both, then 'done'
    rl._reset(['all', '', '', 'done']);
    const doc = makePlanDoc();
    const result = await navigate(doc, false);
    expect(result.comments).toHaveLength(0);
    // rl.question called: 1 (menu) + 2 (sections) + 1 (done) = 4
    expect(rl.question).toHaveBeenCalledTimes(4);
  });

  it("adds comment during linear review when 'all' selected", async () => {
    const rl = await getReadlineMock();
    // main menu: 'all', section 1: 'my comment', section 2: skip, then 'done'
    rl._reset(['all', 'my comment', '', 'done']);
    const doc = makePlanDoc();
    const result = await navigate(doc, false);
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].text).toBe('my comment');
    expect(result.comments[0].sectionId).toBe('1.1');
  });

  it("jumps to section by ID and starts linear review from that section", async () => {
    const rl = await getReadlineMock();
    // jump to '1.2' (second task), comment it, then done
    rl._reset(['1.2', 'comment on 1.2', 'done']);
    const doc = makePlanDoc();
    const result = await navigate(doc, false);
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].sectionId).toBe('1.2');
    expect(result.comments[0].text).toBe('comment on 1.2');
  });

  it("shows error for invalid section input and loops", async () => {
    const rl = await getReadlineMock();
    // first input invalid, then 'done'
    rl._reset(['BADID', 'done']);
    const doc = makePlanDoc();
    await navigate(doc, false);
    const calls = consoleErrorSpy.mock.calls.map((c) => String(c[0]));
    const errorMsg = calls.find((m) => m.includes('not found'));
    expect(errorMsg).toBeTruthy();
  });

  it("handles 'toc' input during linear review to return to menu", async () => {
    const rl = await getReadlineMock();
    // main menu: 'all', section 1: 'toc' (returns to menu), menu: 'done'
    rl._reset(['all', 'toc', 'done']);
    const doc = makePlanDoc();
    const result = await navigate(doc, false);
    expect(result).toBe(doc);
  });

  it("handles 'back' at first section — re-shows same section", async () => {
    const rl = await getReadlineMock();
    // all → back (stays on 1.1) → comment on 1.1 → skip 1.2 → done
    rl._reset(['all', 'back', 'comment after back', '', 'done']);
    const doc = makePlanDoc();
    const result = await navigate(doc, false);
    // Comment should be on 1.1 (re-shown after back)
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].sectionId).toBe('1.1');
    expect(result.comments[0].text).toBe('comment after back');
  });

  it("handles 'back' from second section — goes to first", async () => {
    const rl = await getReadlineMock();
    // all → skip 1.1 → back (goes to 1.1) → comment 1.1 → skip 1.2 → done
    rl._reset(['all', '', 'back', 'revisited 1.1', '', 'done']);
    const doc = makePlanDoc();
    const result = await navigate(doc, false);
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].sectionId).toBe('1.1');
    expect(result.comments[0].text).toBe('revisited 1.1');
  });

  it('calls onCommentChange after a comment is added', async () => {
    const rl = await getReadlineMock();
    // all → comment on 1.1 → skip 1.2 → done
    rl._reset(['all', 'a comment', '', 'done']);
    const doc = makePlanDoc();
    const onCommentChange = vi.fn();
    await navigate(doc, false, onCommentChange);
    expect(onCommentChange).toHaveBeenCalledTimes(1);
    expect(doc.comments).toHaveLength(1);
  });

  it('does not call onCommentChange when sections are skipped', async () => {
    const rl = await getReadlineMock();
    // all → skip both → done
    rl._reset(['all', '', '', 'done']);
    const doc = makePlanDoc();
    const onCommentChange = vi.fn();
    await navigate(doc, false, onCommentChange);
    expect(onCommentChange).not.toHaveBeenCalled();
    expect(doc.comments).toHaveLength(0);
  });

  it('opens /dev/tty when inputFromStdin is true', async () => {
    const rl = await getReadlineMock();
    rl._reset(['done']);
    const fsMod = await import('node:fs');
    const createReadStreamSpy = fsMod.createReadStream as ReturnType<typeof vi.fn>;
    createReadStreamSpy.mockClear();

    const doc = makePlanDoc();
    await navigate(doc, true);
    expect(createReadStreamSpy).toHaveBeenCalledWith('/dev/tty');
  });
});
