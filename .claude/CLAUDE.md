# Drone Lap Counter

Browser PWA that counts drone laps by detecting motion in a camera ROI.

- **v1 (current work)** lives in `app/`. Spec: [docs/final/SPEC-v1.0.0.md](../docs/final/SPEC-v1.0.0.md). Plan: [docs/final/PLAN-v1.0.0.md](../docs/final/PLAN-v1.0.0.md) — follow its milestone/task order and "done when" criteria. Progress notes per milestone: `docs/final/progress/m<N>.md`.
- **PoC** lives in `drone-lap-poc/` — frozen; rules in [CLAUDE-PoC.md](CLAUDE-PoC.md). Only change it when a plan task says so.

## v1 stack

TypeScript strict, React 19, Vite 8, Tailwind v4 (tokens in `src/styles/index.css` `@theme`), `motion`, Zustand, `lucide-react`, `vite-plugin-pwa` (M9), Vitest 5 (+ happy-dom, Testing Library), Playwright, Biome 2. Node 22 (`app/.nvmrc`).
Any other dependency needs a reason in the PR. Allowed test-only additions: `@axe-core/playwright`, `@vitest/coverage-v8`, `happy-dom`, `@testing-library/react`.

## Commands (run in `app/`)

- `npm run dev` — HTTPS dev server on the LAN (`https://<lan-ip>:5173`, accept the cert on the phone)
- `npm run build` · `npm run build:pages` (app + PoC into `dist/poc/`, as deployed) · `npm run preview` · `npm run preview:lan` (build:pages + HTTPS preview on the LAN, for phones)
- `npm run lint` (`biome ci`) · `npm run format` · `npm run typecheck` · `npm test` (Vitest) · `npm run size` (≤ 130 KB gz initial JS)
- `npm run test:e2e` (Playwright, needs a build). On macOS 14 the local WebKit is frozen and fails; use `--project=chromium` locally, WebKit runs in CI.
- CI = `lint → typecheck → test --coverage → build:pages → size → e2e`; every push to `main` deploys to GitHub Pages; manual `workflow_dispatch` deploys any branch.
- URL flags: `?gallery` / `?state=<preset>` (state gallery, `src/ui/gallery/presets.ts`), `?cam=fake` (placeholder camera), `?auto=0`, `?lap=<s>`, `?debug=1`, `?debug=engine` (real-engine debug page: camera/file replay, HUD, CSV export). E2E uses `?cam=fake&auto=0`; WebKit runs only `smoke` + `gallery` specs.

## Module boundaries (spec §5.1, enforced by Biome `noRestrictedImports` / `noRestrictedGlobals`)

- `engine/`, `session/`, `settings/` (except `storage.ts`), `sim/`, `app/machine.ts`: no React, no UI libs, no `ui/`.
- `engine/*` outside `engine/browser/`: no DOM globals.
- `ui/` never imports `engine/browser` or `sim/` (go through the store). `ui/sim/` is UI and is fine.
- No `node:*` imports anywhere in `src/`.

## Rules

- UI first: prototype runs on the real reducer/store/engine interfaces with simulated implementations (`sim/`). Sim is default until M5, then `?sim=1`; always show the `SIMULATED` chip.
- Pure modules ship with their tests in the same task. Every task ends runnable, CI green, committed.
- No per-frame allocation in the frame loop (caller-allocated buffers, swap don't copy). React never renders per frame: store updates ≤ 4 Hz; debug views draw on their own canvas.
- Gesture-bound effects (`audio.unlock`, `camera.start`) run synchronously inside `dispatch` from the tap handler — no `await` before them.
- Times come from frame timestamps (`performance.now()` / `mediaTime·1000`), never `Date`.
- Colours only from the tokens (default Tailwind palette is disabled). Dark only, neon accents; red only for critical actions.
- `vite.config.ts` keeps `base: './'`. localStorage keys always prefixed `dronelap.`.
- Workflow: branch `v1/m<N>-<slug>`, PR into `main`, deploy on merge, check on a phone (footer shows version + git SHA).
- Keep code and comments concise; match the existing style.
