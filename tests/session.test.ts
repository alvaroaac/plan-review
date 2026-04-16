import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ReviewComment } from '../src/types.js';

// Mock os.homedir() to use a temp dir per test
let tempHome: string;

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: () => tempHome,
  };
});

// Import after mock is set up
const {
  getSessionDir,
  computeContentHash,
  saveSession,
  loadSession,
  clearSession,
  listSessions,
} = await import('../src/session.js');

function makeComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    sectionId: 'task-1',
    text: 'Looks good',
    timestamp: new Date('2026-01-15T10:00:00Z'),
    ...overrides,
  };
}

describe('session', () => {
  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'plan-review-test-'));
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  // ---------- getSessionDir ----------
  describe('getSessionDir', () => {
    it('returns path under ~/.plan-review/sessions/', () => {
      const dir = getSessionDir();
      expect(dir).toBe(join(tempHome, '.plan-review', 'sessions'));
    });

    it('creates the directory if it does not exist', () => {
      const dir = getSessionDir();
      expect(existsSync(dir)).toBe(true);
    });

    it('does not throw if directory already exists', () => {
      getSessionDir(); // create it
      expect(() => getSessionDir()).not.toThrow(); // call again
    });
  });

  // ---------- computeContentHash ----------
  describe('computeContentHash', () => {
    it('returns sha256:<hex> format', () => {
      const hash = computeContentHash('hello');
      expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it('returns deterministic results', () => {
      const a = computeContentHash('test content');
      const b = computeContentHash('test content');
      expect(a).toBe(b);
    });

    it('returns different hashes for different content', () => {
      const a = computeContentHash('content A');
      const b = computeContentHash('content B');
      expect(a).not.toBe(b);
    });
  });

  // ---------- saveSession ----------
  describe('saveSession', () => {
    it('writes a JSON file to the session directory', () => {
      const comments = [makeComment()];
      saveSession('/tmp/plan.md', 'sha256:abc123', comments, 'task-1');

      const dir = getSessionDir();
      const files = require('node:fs').readdirSync(dir) as string[];
      expect(files.length).toBe(1);
      expect(files[0]).toMatch(/\.json$/);
    });

    it('writes valid SessionData JSON', () => {
      const comments = [makeComment()];
      saveSession('/tmp/plan.md', 'sha256:abc123', comments, 'task-1');

      const dir = getSessionDir();
      const files = require('node:fs').readdirSync(dir) as string[];
      const content = JSON.parse(readFileSync(join(dir, files[0]), 'utf-8'));

      expect(content.version).toBe(1);
      expect(content.planPath).toBe('/tmp/plan.md');
      expect(content.contentHash).toBe('sha256:abc123');
      expect(content.comments).toHaveLength(1);
      expect(content.comments[0].sectionId).toBe('task-1');
      expect(content.activeSection).toBe('task-1');
      expect(content.lastModified).toBeDefined();
    });

    it('handles activeSection = null', () => {
      saveSession('/tmp/plan.md', 'sha256:abc123', [], null);

      const dir = getSessionDir();
      const files = require('node:fs').readdirSync(dir) as string[];
      const content = JSON.parse(readFileSync(join(dir, files[0]), 'utf-8'));
      expect(content.activeSection).toBeNull();
    });

    it('does not throw on write error (best-effort)', () => {
      // Make session dir a file to cause write error
      const dir = join(tempHome, '.plan-review', 'sessions');
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(join(tempHome, '.plan-review'), { recursive: true });
      writeFileSync(dir, 'not a directory');

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(() => {
        saveSession('/tmp/plan.md', 'sha256:abc', [], null);
      }).not.toThrow();
      consoleSpy.mockRestore();
    });
  });

  // ---------- loadSession ----------
  describe('loadSession', () => {
    it('returns null when no session file exists', () => {
      const result = loadSession('/tmp/nonexistent.md', 'sha256:abc');
      expect(result).toBeNull();
    });

    it('loads comments and activeSection from saved session', () => {
      const comments = [makeComment({ text: 'My review' })];
      saveSession('/tmp/plan.md', 'sha256:abc', comments, 'task-2');

      const result = loadSession('/tmp/plan.md', 'sha256:abc');
      expect(result).not.toBeNull();
      expect(result!.comments).toHaveLength(1);
      expect(result!.comments[0].text).toBe('My review');
      expect(result!.activeSection).toBe('task-2');
    });

    it('sets stale=false when hashes match', () => {
      saveSession('/tmp/plan.md', 'sha256:abc', [], null);
      const result = loadSession('/tmp/plan.md', 'sha256:abc');
      expect(result!.stale).toBe(false);
    });

    it('sets stale=true when hashes differ', () => {
      saveSession('/tmp/plan.md', 'sha256:abc', [], null);
      const result = loadSession('/tmp/plan.md', 'sha256:different');
      expect(result!.stale).toBe(true);
    });

    it('handles corrupt JSON: logs warning, deletes file, returns null', () => {
      // Write a valid session first to get the file path, then corrupt it
      saveSession('/tmp/plan.md', 'sha256:abc', [], null);
      const dir = getSessionDir();
      const files = require('node:fs').readdirSync(dir) as string[];
      const filePath = join(dir, files[0]);

      writeFileSync(filePath, '{{{CORRUPT JSON!!!');

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = loadSession('/tmp/plan.md', 'sha256:abc');
      expect(result).toBeNull();
      expect(existsSync(filePath)).toBe(false);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('restores Date objects in comment timestamps', () => {
      const comment = makeComment({ timestamp: new Date('2026-03-10T12:00:00Z') });
      saveSession('/tmp/plan.md', 'sha256:abc', [comment], null);

      const result = loadSession('/tmp/plan.md', 'sha256:abc');
      expect(result!.comments[0].timestamp).toBeInstanceOf(Date);
      expect(result!.comments[0].timestamp.toISOString()).toBe('2026-03-10T12:00:00.000Z');
    });
  });

  // ---------- clearSession ----------
  describe('clearSession', () => {
    it('deletes an existing session file', () => {
      saveSession('/tmp/plan.md', 'sha256:abc', [], null);
      const dir = getSessionDir();
      const filesBefore = require('node:fs').readdirSync(dir) as string[];
      expect(filesBefore.length).toBe(1);

      clearSession('/tmp/plan.md');
      const filesAfter = require('node:fs').readdirSync(dir) as string[];
      expect(filesAfter.length).toBe(0);
    });

    it('does not throw when session file does not exist', () => {
      expect(() => clearSession('/tmp/nonexistent.md')).not.toThrow();
    });
  });

  // ---------- listSessions ----------
  describe('listSessions', () => {
    it('returns empty array when no sessions exist', () => {
      const sessions = listSessions();
      expect(sessions).toEqual([]);
    });

    it('lists saved sessions with metadata', () => {
      const comments = [makeComment(), makeComment({ text: 'Second' })];
      saveSession('/tmp/plan.md', 'sha256:abc', comments, null);

      const sessions = listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].planPath).toBe('/tmp/plan.md');
      expect(sessions[0].commentCount).toBe(2);
      expect(sessions[0].lastModified).toBeDefined();
    });

    it('lists multiple sessions', () => {
      saveSession('/tmp/plan1.md', 'sha256:aaa', [makeComment()], null);
      saveSession('/tmp/plan2.md', 'sha256:bbb', [], 'task-1');

      const sessions = listSessions();
      expect(sessions).toHaveLength(2);
    });

    it('sets stale=null when plan file does not exist on disk', () => {
      saveSession('/tmp/nonexistent-plan-xyz.md', 'sha256:abc', [], null);

      const sessions = listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].stale).toBeNull();
    });

    it('sets stale=false when plan file hash matches', () => {
      // Create an actual plan file
      const planPath = join(tempHome, 'myplan.md');
      const planContent = '# My Plan\n\n## Task 1\n\nDo something';
      writeFileSync(planPath, planContent);
      const hash = computeContentHash(planContent);

      saveSession(planPath, hash, [], null);

      const sessions = listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].stale).toBe(false);
    });

    it('sets stale=true when plan file hash differs', () => {
      const planPath = join(tempHome, 'myplan.md');
      writeFileSync(planPath, 'original content');
      saveSession(planPath, 'sha256:oldhash', [], null);

      // Plan file on disk has different content from stored hash
      const sessions = listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].stale).toBe(true);
    });

    it('skips non-JSON files in sessions directory', () => {
      getSessionDir(); // ensure dir exists
      const dir = getSessionDir();
      writeFileSync(join(dir, 'not-a-session.txt'), 'random');
      writeFileSync(join(dir, '.DS_Store'), 'junk');

      saveSession('/tmp/plan.md', 'sha256:abc', [], null);

      const sessions = listSessions();
      expect(sessions).toHaveLength(1);
    });

    it('skips corrupt session files gracefully', () => {
      getSessionDir();
      const dir = getSessionDir();
      writeFileSync(join(dir, 'corrupt.json'), '{{NOT VALID JSON');

      saveSession('/tmp/plan.md', 'sha256:abc', [], null);

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const sessions = listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].planPath).toBe('/tmp/plan.md');
      consoleSpy.mockRestore();
    });
  });
});
