import * as vscode from 'vscode';
import { CalendarPanel } from './calendarPanel';

export function activate(context: vscode.ExtensionContext) {
  console.log('Article Calendar extension is now active');

  // コマンド登録
  context.subscriptions.push(
    vscode.commands.registerCommand('articleCalendar.open', () => CalendarPanel.openFromCommand(context)),
    // ワークスペースフォルダの削除に追従
    vscode.workspace.onDidChangeWorkspaceFolders((e) => CalendarPanel.closeRemoved(e.removed)),
  );

  // 自動オープン（マルチルートでは Qiita 記事フォルダすべて）
  const config = vscode.workspace.getConfiguration('articleCalendar');
  if (config.get<boolean>('autoOpen', true)) {
    CalendarPanel.openAll(context);
  }
}

export function deactivate() {}
