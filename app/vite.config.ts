import { execSync } from 'node:child_process';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return process.env.GITHUB_SHA?.slice(0, 7) ?? 'unknown';
  }
}

export default defineConfig(({ command, mode, isPreview }) => ({
  // Relative base: the same build works at `/`, a Pages sub-path and installed.
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    // HTTPS on the LAN for phone testing (camera needs a secure context).
    // Dev server always; `preview` only with LAN_HTTPS=1 (Playwright previews over plain HTTP).
    command === 'serve' && mode !== 'test' && (!isPreview || process.env.LAN_HTTPS === '1') && basicSsl(),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __GIT_SHA__: JSON.stringify(gitSha()),
  },
  server: { host: true },
}));
