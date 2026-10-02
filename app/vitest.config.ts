import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default defineConfig((env) =>
  mergeConfig(viteConfig(env), {
    test: {
      // Pure modules run in Node; only ui/ gets a DOM.
      projects: [
        {
          extends: true,
          test: { name: 'unit', environment: 'node', include: ['src/**/*.test.ts'], exclude: ['src/ui/**'] },
        },
        {
          extends: true,
          test: {
            name: 'ui',
            environment: 'happy-dom',
            include: ['src/ui/**/*.test.{ts,tsx}'],
            setupFiles: ['src/test/setup-ui.ts'],
          },
        },
      ],
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/main.tsx', 'src/env.d.ts'],
        reporter: ['text-summary', 'html'],
        // Spec §5.4: ≥ 90 % lines on the pure core (engine/ joins in M4).
        thresholds: {
          'src/session/**': { lines: 90 },
          'src/settings/**': { lines: 90 },
          'src/app/machine.ts': { lines: 90 },
        },
      },
    },
  }),
);
