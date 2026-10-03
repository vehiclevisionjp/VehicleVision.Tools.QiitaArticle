import { describe, expect, it } from 'vitest';
import {
  hasField,
  removeField,
  setField,
  splitFrontMatter,
} from '../src/frontMatter';

const lf =
  '---\ntitle: a\nprivate: false\nignorePublish: true\n---\n\nprivate: true in body\n';
const crlf = lf.replace(/\n/g, '\r\n');

describe('frontMatter', () => {
  it('splitFrontMatter は Front Matter がなければ null', () => {
    expect(splitFrontMatter('no front matter')).toBeNull();
    expect(splitFrontMatter('---\ntitle: a\n')).toBeNull();
  });

  it('setField は既存フィールドを置換し、本文には触れない', () => {
    const out = setField(lf, 'private', 'true');
    expect(out).toContain('private: true\nignorePublish');
    expect(out.endsWith('private: true in body\n')).toBe(true);
    expect(out.match(/private:/g)).toHaveLength(2);
  });

  it('setField は存在しないフィールドを Front Matter 末尾に追加する', () => {
    const out = setField(lf, 'scheduled_publish', '"2030-01-01"');
    expect(out).toContain(
      'ignorePublish: true\nscheduled_publish: "2030-01-01"\n---',
    );
  });

  it('removeField はフィールド行を削除する', () => {
    const out = removeField(lf, 'ignorePublish');
    expect(out).not.toContain('ignorePublish');
    expect(out).toContain('title: a');
  });

  it('CRLF を維持する', () => {
    const out = setField(crlf, 'scheduled_publish', '"2030-01-01"');
    expect(out).toContain(
      'ignorePublish: true\r\nscheduled_publish: "2030-01-01"\r\n---',
    );
    expect(out.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('キー名の大文字小文字を区別しない', () => {
    expect(hasField('---\nIgnorePublish: true\n---\n', 'ignorePublish')).toBe(
      true,
    );
    expect(
      setField('---\nIgnorePublish: true\n---\n', 'ignorePublish', 'false'),
    ).toContain('ignorePublish: false');
  });

  it('本文だけにあるフィールドは存在しない扱い', () => {
    expect(hasField(lf, 'id')).toBe(false);
    expect(removeField('---\ntitle: a\n---\nid: 1\n', 'id')).toContain('id: 1');
  });
});
