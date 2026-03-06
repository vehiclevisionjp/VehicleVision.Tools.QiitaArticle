import * as vscode from 'vscode';
import { CalendarPanel } from './calendarPanel';

export function activate(context: vscode.ExtensionContext) {
  console.log('Article Calendar extension is now active');

  // コマンド登録
  context.subscriptions.push(
    vscode.commands.registerCommand('articleCalendar.open', () => {
      CalendarPanel.createOrShow(context);
    })
  );

  // 自動オープン
  const config = vscode.workspace.getConfiguration('articleCalendar');
  if (config.get<boolean>('autoOpen', true)) {
    CalendarPanel.createOrShow(context);
  }
}

export function deactivate() {}
