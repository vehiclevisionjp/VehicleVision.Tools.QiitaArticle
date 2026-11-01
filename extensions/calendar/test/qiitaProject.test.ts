import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isQiitaRoot } from '../src/qiitaProject';

describe('Qiita workspace detection', () => {
  it('requires settings or a CLI dependency; public alone is insufficient', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiita-project-'));
    try {
      fs.mkdirSync(path.join(root, 'public'));
      expect(isQiitaRoot(root)).toBe(false);
      fs.writeFileSync(path.join(root, 'package.json'), '{invalid');
      expect(isQiitaRoot(root)).toBe(false);
      for (const field of ['dependencies', 'devDependencies']) {
        fs.writeFileSync(
          path.join(root, 'package.json'),
          JSON.stringify({ [field]: { '@qiita/qiita-cli': '1.12.0' } }),
        );
        expect(isQiitaRoot(root)).toBe(true);
      }
      fs.writeFileSync(
        path.join(root, 'package.json'),
        '{"dependencies":{"qiita-cli":"1"}}',
      );
      expect(isQiitaRoot(root)).toBe(false);
      fs.writeFileSync(path.join(root, 'qiita.config.json'), '{}');
      expect(isQiitaRoot(root)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
