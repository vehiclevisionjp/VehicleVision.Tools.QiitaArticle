import { defineConfig } from 'vitest/config';
import * as path from 'path';

export default defineConfig({
  resolve: {
    alias: { vscode: path.resolve(__dirname, 'test/vscodeStub.ts') },
  },
  test: {
    include: ['test/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
  },
});
