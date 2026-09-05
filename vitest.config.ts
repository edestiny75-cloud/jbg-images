import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/** The no-op `server-only` ships for react-server runtimes; its exports map hides it. */
const serverOnlyNoop = fileURLToPath(
  new URL('./node_modules/server-only/empty.js', import.meta.url),
);

/**
 * Two environments, split by what the code under test needs.
 *
 * The domain layer is pure and runs in plain node, which keeps it honest — a
 * `window` reference there would fail the suite. Anything that renders, hooks
 * included, needs a DOM.
 */
export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        extends: true,
        resolve: {
          /**
           * Server modules import `server-only`, whose default entry throws;
           * only a runtime asking for the "react-server" condition gets the
           * no-op. Aliasing straight to that no-op is scoped and explicit —
           * enabling the condition globally would also swap React for its RSC
           * build and break every component test.
           */
          alias: { 'server-only': serverOnlyNoop },
        },
        test: {
          name: 'domain',
          environment: 'node',
          // Hooks live in .ts files but render, so they belong to the jsdom project.
          include: ['src/**/*.test.ts'],
          exclude: ['src/lib/hooks/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'components',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx', 'src/lib/hooks/**/*.test.ts'],
          setupFiles: ['./vitest.setup.ts'],
        },
      },
    ],
  },
});
