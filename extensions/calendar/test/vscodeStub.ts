/** テスト用の vscode モジュールスタブ（CalendarPanel の検証に必要な範囲のみ） */
import * as path from 'path';

type Listener = (...args: any[]) => void;

export class Disposable {
  constructor(private readonly fn: () => void = () => {}) {}
  dispose() {
    this.fn();
  }
}

export const Uri = {
  file: (fsPath: string) => ({ fsPath, scheme: 'file' }),
  joinPath: (base: { fsPath: string }, ...parts: string[]) => ({
    fsPath: path.join(base.fsPath, ...parts),
  }),
  parse: (value: string) => ({
    fsPath: value,
    scheme: value.split(':')[0],
  }),
};

export class RelativePattern {
  constructor(
    public base: unknown,
    public pattern: string,
  ) {}
}

export const ViewColumn = { One: 1, Beside: -2 };

export interface FakeWatcher {
  pattern: RelativePattern;
  disposed: boolean;
  fire(kind: 'change' | 'create' | 'delete'): void;
  dispose(): void;
}

export interface FakePanel {
  title: string;
  disposed: boolean;
  revealed: number;
  posted: any[];
  webview: {
    html: string;
    cspSource: string;
    asWebviewUri(uri: { fsPath: string }): string;
    postMessage(message: unknown): Promise<boolean>;
    onDidReceiveMessage(
      listener: Listener,
      thisArg?: unknown,
      disposables?: Disposable[],
    ): Disposable;
  };
  /** webview からのメッセージを送る */
  receive(message: unknown): void;
  reveal(column?: number): void;
  onDidDispose(
    listener: Listener,
    thisArg?: unknown,
    disposables?: Disposable[],
  ): Disposable;
  dispose(): void;
}

export const state = {
  panels: [] as FakePanel[],
  watchers: [] as FakeWatcher[],
  errors: [] as string[],
  configuration: {} as Record<string, unknown>,
  quickPickResult: undefined as unknown,
  quickPickItems: [] as unknown[],
  openedExternal: [] as unknown[],
  openedDocuments: [] as string[],
};

export function resetState() {
  state.panels.length = 0;
  state.watchers.length = 0;
  state.errors.length = 0;
  state.configuration = {};
  state.quickPickResult = undefined;
  state.quickPickItems = [];
  state.openedExternal.length = 0;
  state.openedDocuments.length = 0;
  workspace.workspaceFolders = undefined;
}

export const workspace: {
  workspaceFolders:
    Array<{ uri: { fsPath: string }; name: string; index: number }> | undefined;
  [key: string]: any;
} = {
  workspaceFolders: undefined,
  getConfiguration: () => ({
    get: <T>(key: string, fallback: T): T =>
      (key in state.configuration ? state.configuration[key] : fallback) as T,
  }),
  onDidChangeConfiguration: () => new Disposable(),
  createFileSystemWatcher: (pattern: RelativePattern) => {
    const listeners: Record<string, Listener[]> = {};
    const watcher: FakeWatcher & Record<string, any> = {
      pattern,
      disposed: false,
      fire: (kind) => (listeners[kind] ?? []).forEach((l) => l()),
      dispose: () => {
        watcher.disposed = true;
      },
      onDidChange: (l: Listener) => (listeners.change ??= []).push(l),
      onDidCreate: (l: Listener) => (listeners.create ??= []).push(l),
      onDidDelete: (l: Listener) => (listeners.delete ??= []).push(l),
    };
    state.watchers.push(watcher);
    return watcher;
  },
  openTextDocument: async (filePath: string) => {
    state.openedDocuments.push(filePath);
    return { fileName: filePath };
  },
};

export const window = {
  createWebviewPanel: (
    _viewType: string,
    title: string,
    _column: number,
    _options: unknown,
  ): FakePanel => {
    let messageListener: Listener | undefined;
    const disposeListeners: Listener[] = [];
    const panel: FakePanel = {
      title,
      disposed: false,
      revealed: 0,
      posted: [],
      webview: {
        html: '',
        cspSource: 'csp-source',
        asWebviewUri: (uri) => `webview:${uri.fsPath}`,
        postMessage: async (message) => {
          panel.posted.push(message);
          return true;
        },
        onDidReceiveMessage: (listener, _thisArg, disposables) => {
          messageListener = listener;
          const d = new Disposable();
          disposables?.push(d);
          return d;
        },
      },
      receive: (message) => messageListener?.(message),
      reveal: () => {
        panel.revealed++;
      },
      onDidDispose: (listener, _thisArg, disposables) => {
        disposeListeners.push(listener);
        const d = new Disposable();
        disposables?.push(d);
        return d;
      },
      dispose: () => {
        if (panel.disposed) return;
        panel.disposed = true;
        disposeListeners.forEach((l) => l());
      },
    };
    state.panels.push(panel);
    return panel;
  },
  showErrorMessage: (message: string) => {
    state.errors.push(message);
  },
  showQuickPick: async (items: unknown[]) => {
    state.quickPickItems = items;
    return state.quickPickResult;
  },
  showTextDocument: async () => {},
};

export const env = {
  openExternal: async (uri: unknown) => {
    state.openedExternal.push(uri);
    return true;
  },
};
