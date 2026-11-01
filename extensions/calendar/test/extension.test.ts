import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { activate } from '../src/extension';
import { CalendarPanel } from '../src/calendarPanel';
import { resetState, state, Uri } from './vscodeStub';

let tmp: string;

beforeEach(() => {
  resetState();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-ext-'));
  fs.writeFileSync(path.join(tmp, 'qiita.config.json'), '{}');
  (vscode.workspace as any).workspaceFolders = [
    { uri: Uri.file(tmp), name: 'repo', index: 0 },
  ];
  (vscode as any).commands = {
    registered: {} as Record<string, () => unknown>,
    registerCommand(id: string, fn: () => unknown) {
      this.registered[id] = fn;
      return { dispose() {} };
    },
  };
  (vscode.workspace as any).onDidChangeWorkspaceFolders = (
    l: (e: unknown) => void,
  ) => {
    (vscode.workspace as any).folderListener = l;
    return { dispose() {} };
  };
});

afterEach(() => {
  for (const p of [...state.panels]) p.dispose();
  fs.rmSync(tmp, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 100,
  });
});

describe('activate', () => {
  it('autoOpen が有効なら起動時にパネルを開き、コマンドを登録する', () => {
    const context = { extensionUri: Uri.file('/ext'), subscriptions: [] } as any;
    activate(context);
    expect(state.panels).toHaveLength(1);
    expect(context.subscriptions).toHaveLength(2);
    expect(
      typeof (vscode as any).commands.registered['articleCalendar.open'],
    ).toBe('function');
  });

  it('autoOpen が無効なら開かず、フォルダ削除でパネルを閉じる', async () => {
    state.configuration.autoOpen = false;
    const context = { extensionUri: Uri.file('/ext'), subscriptions: [] } as any;
    activate(context);
    expect(state.panels).toHaveLength(0);

    await (vscode as any).commands.registered['articleCalendar.open']();
    expect(state.panels).toHaveLength(1);

    (vscode.workspace as any).folderListener({
      removed: (vscode.workspace as any).workspaceFolders,
    });
    expect(state.panels[0].disposed).toBe(true);
    expect(CalendarPanel.getCandidateFolders()).toHaveLength(1);
  });
});
