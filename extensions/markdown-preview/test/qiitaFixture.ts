import { afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'qiita-fixture-'));
fs.writeFileSync(path.join(ROOT, 'qiita.config.json'), '{}');
afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));
