import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findQiitaRoots, isQiitaRoot } from '../src/qiitaProject';

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

describe('findQiitaRoots', () => {
  const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qiita-roots-'));
  const qiita = (dir: string) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'qiita.config.json'), '{}');
  };

  it('returns the folder itself when it is a Qiita root', () => {
    const root = mk();
    try {
      qiita(root);
      qiita(path.join(root, 'child'));
      expect(findQiitaRoots(root)).toEqual([root]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('falls back to direct child Qiita roots of a parent folder', () => {
    const root = mk();
    try {
      qiita(path.join(root, 'a'));
      qiita(path.join(root, 'b'));
      fs.mkdirSync(path.join(root, 'plain'));
      qiita(path.join(root, 'node_modules', 'x'));
      qiita(path.join(root, '.hidden'));
      qiita(path.join(root, 'plain', 'grandchild'));
      expect(findQiitaRoots(root).sort()).toEqual(
        [path.join(root, 'a'), path.join(root, 'b')].sort(),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns an empty list for missing or unrelated folders', () => {
    const root = mk();
    try {
      expect(findQiitaRoots(root)).toEqual([]);
      expect(findQiitaRoots(path.join(root, 'missing'))).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
