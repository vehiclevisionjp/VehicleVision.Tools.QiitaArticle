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
