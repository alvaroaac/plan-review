import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EXT_ID = 'alvarocarvalho.plan-review-vscode';

suite('plan-review extension', () => {
  suiteSetup(async function () {
    this.timeout(60_000);
    const all = vscode.extensions.all.map((e) => e.id);
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext, `extension ${EXT_ID} not found. Available: ${all.join(', ')}`);
    await ext!.activate();
  });

  test('registers plan-review.open command', async () => {
    const cmds = await vscode.commands.getCommands(true);
    assert.ok(cmds.includes('plan-review.open'), 'plan-review.open not registered');
  });

  test('plan-review.open executes without throwing for a plan URI', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'pr-it-'));
    const planPath = join(tmp, 'plan.md');
    writeFileSync(planPath, '# Plan\n## Section\n**Verification:** ok\nBody\n');
    const uri = vscode.Uri.file(planPath);
    await vscode.commands.executeCommand('plan-review.open', uri);
    // Give the panel a tick to render.
    await new Promise((r) => setTimeout(r, 500));
    assert.ok(true); // no-throw passes
  });
});
