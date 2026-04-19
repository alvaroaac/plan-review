import Mocha from 'mocha';
import { glob } from 'glob';
import { resolve } from 'node:path';

export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 60_000 });
  const files = await glob('**/*.integration.test.js', { cwd: __dirname });
  files.forEach((f: string) => mocha.addFile(resolve(__dirname, f)));
  await new Promise<void>((ok, fail) => mocha.run((failures: number) => failures ? fail(new Error(`${failures} failed`)) : ok()));
}
