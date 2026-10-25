import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// Test projects (0005, 0006). `build` needs `npm run build` first.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: [
            'packages/*/src/**/*.test.ts',
            'scripts/**/*.test.ts',
            'test/repo/**/*.test.ts',
            '*.test.ts',
          ],
        },
      },
      {
        test: {
          name: 'dom',
          environment: 'happy-dom',
          include: ['apps/*/src/**/*.test.{ts,tsx}', 'packages/ui/src/**/*.test.tsx'],
        },
      },
      {
        test: {
          name: 'build',
          environment: 'node',
          include: ['test/build/**/*.test.ts'],
        },
      },
      {
        // Bind to IPv4 so the test can reach the same server as a second origin via 'localhost'.
        server: { host: '127.0.0.1' },
        test: {
          name: 'browser',
          include: ['test/browser/**/*.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
