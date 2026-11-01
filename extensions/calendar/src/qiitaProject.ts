import * as fs from 'fs';
import * as path from 'path';

/** Identify each workspace folder independently; public/ alone is not evidence. */
export function isQiitaRoot(root: string): boolean {
  if (fs.existsSync(path.join(root, 'qiita.config.json'))) return true;
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
    );
    return [manifest.dependencies, manifest.devDependencies].some(
      (dependencies) =>
        dependencies &&
        Object.prototype.hasOwnProperty.call(dependencies, '@qiita/qiita-cli'),
    );
  } catch {
    return false;
  }
}

/**
 * Qiita roots for a workspace folder: the folder itself, or, when it is a plain
 * parent directory (e.g. D:\repos\doc), its direct child directories that qualify.
 */
export function findQiitaRoots(root: string): string[] {
  if (isQiitaRoot(root)) return [root];
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name !== 'node_modules' &&
          !entry.name.startsWith('.'),
      )
      .map((entry) => path.join(root, entry.name))
      .filter(isQiitaRoot);
  } catch {
    return [];
  }
}
