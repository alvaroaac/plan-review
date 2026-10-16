// Records the browser-mode demo GIF used in the READMEs.
// Usage: npm run build && node scripts/record-demo.mjs   (needs ffmpeg on PATH)
import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUTPUT = join(ROOT, 'examples', 'demo-browser.gif');
const VIEWPORT = { width: 1280, height: 800 };

// Playwright videos have no pointer, so the page draws one that follows the mouse.
const CURSOR = `
  addEventListener('DOMContentLoaded', () => {
    const dot = document.createElement('div');
    dot.style.cssText = 'position:fixed;z-index:99999;width:18px;height:18px;margin:-9px 0 0 -9px;'
      + 'border-radius:50%;background:rgba(220,60,60,.55);border:2px solid #fff;pointer-events:none;'
      + 'box-shadow:0 1px 4px rgba(0,0,0,.35);transition:transform .1s;left:-40px;top:-40px';
    document.body.append(dot);
    addEventListener('mousemove', (e) => { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'; });
    addEventListener('mousedown', () => { dot.style.transform = 'scale(.7)'; });
    addEventListener('mouseup', () => { dot.style.transform = ''; });
  });
`;

function startCli(home) {
  const child = spawn(process.execPath, [join(ROOT, 'packages/cli/dist/index.js'), join(ROOT, 'examples/demo-plan.md'), '-o', 'stdout'], {
    cwd: ROOT,
    // Stub `open` so the CLI doesn't launch a real browser window.
    env: { ...process.env, PLAN_REVIEW_HOME: home, PATH: `${join(home, 'bin')}${delimiter}${process.env.PATH}` },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const url = new Promise((resolveUrl, reject) => {
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk;
      const match = stderr.match(/http:\/\/[^\s]+/);
      if (match) resolveUrl(match[0]);
    });
    child.once('close', () => reject(new Error(`CLI exited early: ${stderr}`)));
  });
  return { child, url };
}

async function moveTo(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 });
  await page.waitForTimeout(250);
}

async function click(page, locator) {
  await moveTo(page, locator);
  await locator.click();
  await page.waitForTimeout(600);
}

async function type(page, locator, text) {
  await click(page, locator);
  await page.keyboard.type(text, { delay: 35 });
  await page.waitForTimeout(400);
}

async function demo(page) {
  await page.waitForSelector('.doc-title');
  await page.mouse.move(640, 300);
  await page.waitForTimeout(1500);

  // Confirm an assumption; saving moves focus on to the next open item.
  const bcrypt = page.locator('#card-bcrypt-cost');
  await click(page, bcrypt.getByRole('button', { name: 'Holds', exact: true }));
  await click(page, bcrypt.getByRole('button', { name: 'Save', exact: true }));
  await page.waitForTimeout(800);

  // Override the author's pick on a decision, with a rationale.
  const store = page.locator('#card-rate-limit-store');
  await click(page, store.locator('label.opt', { hasText: 'Postgres table keyed by email' }));
  await type(page, store.getByPlaceholder('Rationale (optional)'), 'We already run Postgres; no new Redis.');
  await click(page, store.getByRole('button', { name: 'Save decision', exact: true }));
  await page.waitForTimeout(800);

  // Comment on a paragraph.
  const paragraph = page.locator('.doc > section .para').filter({ hasText: 'Add an index on' });
  await moveTo(page, paragraph);
  await click(page, paragraph.getByRole('button', { name: 'Comment on this paragraph' }));
  await page.keyboard.type('Make this index unique.', { delay: 35 });
  await click(page, page.locator('.composer').getByRole('button', { name: 'Comment', exact: true }));

  // Send it back to the agent.
  await click(page, page.getByRole('button', { name: 'Submit review', exact: true }));
  await type(page, page.getByPlaceholder('Summary for the agent (optional)'), 'Close, a couple of changes.');
  await click(page, page.getByRole('button', { name: 'Request changes', exact: true }));
  await page.getByRole('heading', { name: 'Review submitted', exact: true }).waitFor();
  await page.waitForTimeout(2000);
}

// Chrome's screencast sends a lossless frame only when the page repaints, unlike
// Playwright's lossy video, so unchanged regions stay identical and the GIF stays small.
async function screencast(page, run) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    frames.push({ data, time: metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'png', maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height });
  await run();
  await cdp.send('Page.stopScreencast');
  return frames;
}

async function writeGif(dir, frames) {
  // The concat list carries each frame's real on-screen duration; the last one holds for 2 s.
  const lines = [];
  for (const [i, frame] of frames.entries()) {
    const file = join(dir, `frame${i}.png`);
    await writeFile(file, Buffer.from(frame.data, 'base64'));
    const duration = i + 1 < frames.length ? frames[i + 1].time - frame.time : 2;
    lines.push(`file '${file}'`, `duration ${duration.toFixed(3)}`);
  }
  lines.push(lines.at(-2)); // concat ignores the last entry's duration unless the file repeats
  await writeFile(join(dir, 'frames.txt'), lines.join('\n'));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(dir, 'frames.txt'),
    '-vf', 'scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
    '-fps_mode', 'vfr', OUTPUT]);
}

const home = await mkdtemp(join(tmpdir(), 'plan-review-demo-'));
await mkdir(join(home, 'bin'));
for (const command of ['open', 'xdg-open']) await writeFile(join(home, 'bin', command), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

const cli = startCli(home);
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: VIEWPORT });
  await context.addInitScript(CURSOR);
  const page = await context.newPage();
  await page.goto(await cli.url);
  const frames = await screencast(page, () => demo(page));
  await writeGif(home, frames);
  console.log(`Wrote ${OUTPUT}`);
} finally {
  await browser.close();
  cli.child.kill();
  await rm(home, { recursive: true, force: true });
}
