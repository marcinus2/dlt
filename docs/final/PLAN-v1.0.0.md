# Drone Lap Counter — v1.0.0 Implementation Plan

> Status: plan rev 2, 2026-10-02 — **UI first**. Source spec: [SPEC-v1.0.0.md](SPEC-v1.0.0.md) (all decisions settled). PoC references: [dev plan](../PoC/dev-plan.md), [first phone tests](../PoC/first-tests-findings.md).
> **UI first** (spec §6.1): a clickable, simulated version of the whole UI goes to GitHub Pages first, so the look and feel can be checked on real devices before detection is wired in. Milestone numbers match spec §6.1; §1 also maps them to the spec's first (detection-first) order.
> Items marked **[gap]** clarify or extend the spec so tests can be written; they are collected in §14.

## 0. Ground rules

- v1 lives in `app/` (D7). The PoC in `drone-lap-poc/` is not changed, except the one-line SW opt-out in task 1.7.
- **UI first, real interfaces.** The prototype is built on the real `reduce` state machine, the real store and effect runner, and the real `DetectorEngine` / `FrameSource` interfaces (spec §5.2), with **simulated implementations** behind them. Swapping in the real engine (M5) changes wiring only, not screens.
- **Simulation mode** is the default until M5, then opt-in with `?sim=1`. It is always marked on screen with a `SIMULATED` chip, so nobody mistakes it for real timing.
- **Every merge to `main` deploys to GitHub Pages**, so each change can be checked on any phone at the public HTTPS URL. A branch can also be deployed by hand (task 1.7) for testing before merge.
- Stack is fixed by spec §2: TypeScript strict, React 19, Vite 8, Tailwind v4, `motion`, Zustand, `lucide-react`, `vite-plugin-pwa`, Vitest, Playwright, Biome. Any other dependency needs a reason in the PR. Allowed test-only additions: `@axe-core/playwright`, `@vitest/coverage-v8`, `happy-dom`, `@testing-library/react`.
- Commands (run in `app/`): `npm run dev` (HTTPS, `--host`), `build`, `preview`, `test` (Vitest), `test:e2e` (Playwright), `lint` (`biome ci`), `typecheck` (`tsc --noEmit`), `size` (bundle budget).
- Module boundaries from spec §5.1 are enforced by Biome from day one: `engine/`, `session/`, `settings/` (except `storage.ts`), `sim/` and `app/machine.ts` import no React and no `ui/`; `engine/*` outside `engine/browser/` touches no DOM globals; `ui/` never imports `engine/browser` or `sim/` directly (it goes through the store; the only exception is `CameraLayer` receiving the `<video>`).
- Pure modules ship with their tests in the same task. Every task ends runnable, CI green, and with a commit.
- No per-frame allocation in the frame loop (caller-allocated buffers, swap don't copy). React never renders per frame: samples and stats reach the UI only through throttled store updates (≤ 4 Hz) or debug components that draw on their own canvas.
- Effects that need a user gesture (`audio.unlock`, `camera.start`) run **synchronously inside `dispatch`** called from the tap handler. No `await` before them.
- All times come from frame timestamps (`performance.now()` clock or `mediaTime·1000`), never `Date`.
- Workflow: one branch per milestone (`v1/m<N>-<slug>`), PR into `main`, deploy on merge. Each milestone ends deployed and checked on a phone.

## 1. Milestones and order

| # | Milestone | Rough effort | Depends on | Was (detection-first order) |
|---|---|---|---|---|
| M0 | Field validation (PoC) | 1–1.5 d (needs the real setup) | — (parallel with M1–M4) | M0 |
| M1 | Scaffold + CI + Pages deploy | 1 d | — | M1 (+ static manifest from M8) |
| M2 | **UX prototype** (all screens, simulated engine) | 4–5 d | M1 | M7, logic + store of M3, form of M5 |
| M3 | **UX review → freeze** on real devices | 1 d + iterations | M2 | new |
| M4 | Engine port | 2–3 d | M1 (M3 not needed) | M2 |
| M5 | Real detection in the app | 1.5–2 d | M3, M4, **M0** | rest of M3 |
| M6 | Audio | 1–1.5 d | M5 | M4 |
| M7 | Configuration functionality | 2 d | M5 | rest of M5 |
| M8 | Platform robustness | 1.5–2 d | M5 | M6 |
| M9 | PWA offline + install | 1–1.5 d | M6, M7, M8 | M8 |
| M10 | Release hardening → v1.0.0 | 1.5–2 d | M9 | M9 |

```
M0 ─────────────────────────────────┐
M1 → M2 → M3 (UX freeze) ───────────┤
M1 → M4 (engine port, can overlap) ─┴→ M5 → { M6, M7, M8 } → M9 → M10
```

M4 has no UI dependency, so it can run alongside M2/M3. M9 can be pulled earlier if offline field testing is needed.

## 2. M0 — Field validation (PoC, parallel, D8)

Uses the PoC as-is on the reference Samsung and an iPhone. Scenarios and metrics from brainstorm §Testing / §Metrics.

| # | Task | Output | Done when |
|---|---|---|---|
| 0.1 | Run scenarios 1–6 (static ceiling 5 min, lights on/off, 20 tosses, 10 whoop laps, …) with the phone flat, front camera, defaults | events + frames CSV per scenario | all scenarios run, CSVs saved |
| 0.2 | iPhone re-check (Safari + installed PWA): delivered fps, exposure capability, false triggers at threshold 10 | notes | iOS behaviour written down |
| 0.3 | Δstart vs Δpeak spread on the whoop laps | numbers | D1 confirmed (Δstart) or revised in the spec |
| 0.4 | Commit ≥ 3 frames-CSV fixtures (whoop laps, static, lights) | `app/test/fixtures/field/*.csv` | files committed with a short README of the scenario and expected pass count |
| 0.5 | PoC README **Findings** + a list of default changes (incl. per-platform need, e.g. iOS threshold) | `drone-lap-poc/README.md` | findings merged; default list handed to 5.3 |

**Gate:** detection defaults are frozen in 5.3, only after 0.5. The prototype uses the current PoC defaults.

## 3. M1 — Scaffold + CI + Pages deploy

| # | Task | Files | Done when |
|---|---|---|---|
| 1.1 | Project skeleton: `package.json` (scripts in §0, `"version": "1.0.0-dev"`), Vite 8 + `@vitejs/plugin-react` + `@tailwindcss/vite`, `@vitejs/plugin-basic-ssl` (dev only), `base: './'`, `define` app version + git short SHA, `tsconfig.json` strict, `.nvmrc` 22 | `app/package.json`, `vite.config.ts`, `tsconfig.json` | `npm run dev` serves over HTTPS on the LAN; `npm run build` works |
| 1.2 | Biome config: format + lint, `noRestrictedImports` overrides per folder (§0 boundaries) | `app/biome.json` | a deliberate bad import in `engine/` fails `npm run lint` |
| 1.3 | Design tokens + base CSS: `@theme` tokens (spec §4.1), Inter + JetBrains Mono via `@fontsource-variable` (latin), `100dvh`, safe-area padding helpers, `overscroll-behavior: none`, `touch-action: manipulation`, focus ring; `index.html` meta (`viewport-fit=cover`, `theme-color`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style: black-translucent`) | `src/styles/index.css`, `index.html` | tokens usable as Tailwind classes; no external font requests |
| 1.4 | Empty shell: `main.tsx`, `App.tsx` with a placeholder Welcome; footer shows version + git SHA (so a device tester can tell which build they see) | `src/main.tsx`, `src/ui/…` | shell renders on phone and desktop |
| 1.5 | Vitest (node env by default, happy-dom for `src/ui/**`, coverage v8) + one smoke test; Playwright config (Chromium project, WebKit project for layout/axe; `webServer: npm run preview`; fake-camera flags added in M5) + one smoke e2e | `vitest.config.ts`, `playwright.config.ts`, `e2e/smoke.spec.ts` | `npm test` and `npm run test:e2e` pass locally |
| 1.6 | Bundle budget script: gzip the JS chunks referenced by `dist/index.html` (initial load only, lazy chunks excluded), fail > 130 KB | `app/scripts/check-size.mjs` | `npm run size` prints the total and exit code is correct |
| 1.7 | CI + deploy: `ci.yml` on PR and main — PoC `npm test`; app `npm ci` → `lint` → `typecheck` → `test --coverage` → `build` → `size` → Playwright Chromium. Deploy job on push to `main` **and on `workflow_dispatch` from any branch** (for device testing before merge; allow the branch under Settings → Environments → `github-pages`): app `dist/` + PoC built with `VITE_NO_SW=1 vite build --outDir ../app/dist/poc`. PoC `pwa.js` skips registration when `VITE_NO_SW` is set. Replaces `deploy.yml` | `.github/workflows/ci.yml`, `drone-lap-poc/src/pwa.js` | PR shows all stages; Pages serves v1 at `/` and the PoC at `/poc/` without SW; a manual branch deploy works |
| 1.8 | Static manifest (no service worker yet): name, `display: standalone`, `orientation: portrait`, colours, icons (PoC icons for now) so **Add to Home Screen** shows the standalone layout (safe areas, status bar) from the start. Replaced by `vite-plugin-pwa` in M9 | `public/manifest.webmanifest`, `public/icons/*` | installed on Android and iPhone, opens standalone |
| 1.9 | Update `.claude/CLAUDE.md` with the v1 stack, commands, boundaries and ground rules (§0); point to this plan; keep `CLAUDE-PoC.md` for PoC work | `.claude/CLAUDE.md` | merged |

**M1 exit:** the Pages URL opens the shell on Android and iOS (browser and home screen); PoC reachable at `/poc/`; CI runs all stages.

## 4. M2 — UX prototype (simulated)

Goal: the complete app as a user sees it, at the final visual quality, running on simulated camera and passes. Everything here except `sim/` and the gallery is production code that stays.

| # | Task | Files | Done when |
|---|---|---|---|
| 2.1 | Lap logic per spec §3.3: `applyPass` (standby → running with `refT`; running → append lap), `stop` (→ standby, laps kept), incremental best (ties → earlier), `formatLap` (`ss.cc` / `m:ss.cc`, rounded to 10 ms), `speechText` ("Go", "12.34", "Best, 12.34", "1 minute 5.34", "Paused") | `src/session/types.ts`, `laps.ts` (+ tests) | tests cover first pass, STOP/CONTINUE boundary (no lap spans a pause), ties, 59.995 s rounding, ≥ 60 s format |
| 2.2 | `reduce(state, event)` per spec §3.2 transition table and §14 gaps; dialogs as a field; "has data" guard; detection keeps running under a dialog | `src/app/machine.ts` (+ test) | **one test per table row** + illegal events per screen + each §14 gap |
| 2.3 | Settings schema: one metadata table (key, type, default, min/max/step, unit, group, advanced, help) from spec §1.3 with the current PoC defaults; `validate.ts` (per field → default on wrong type/out of range; cross-field: `endRatio ≤ startRatio`, `maxMotionMs > minMotionMs`, ROI inside frame, w/h ≥ 0.05); basic `storage.ts` (`dronelap.settings.v2`, written only on Save, in-memory fallback). PoC migration comes in M7 | `src/settings/schema.ts`, `validate.ts`, `storage.ts` (+ tests) | every key has range tests; cross-field rules tested |
| 2.4 | Zustand store (`state`, `dispatch`, saved/draft settings, UI flags) + effect runner over an injected `Effects` interface (`camera`, `engine`, `audio`, `wakeLock`, `settings`). Engine `pass` → `PASS`, `phase: armed` → `ARMED`, camera start → `CAMERA_LIVE`/`CAMERA_ERROR`, `onEnded` → `CAMERA_LOST` | `src/app/store.ts`, `effects.ts` (+ test with fake effects) | effects run synchronously in `dispatch`; a `PASS` from an old run id is ignored |
| 2.5 | Simulated implementations: `SimEngine` implements `DetectorEngine` (warm-up → `armed` after `warmupMs`; auto passes with random lap times, respecting `cooldownMs`; manual `pass()`; fake `stats()` incl. a "low fps" switch); `SimCamera` implements `FrameSource` (real `getUserMedia` preview when allowed, otherwise an animated `canvas.captureStream()` placeholder; can simulate each `CameraError` kind and a mid-session `ended`). Audio and wake-lock effects log only | `src/sim/sim-engine.ts`, `sim-camera.ts` (+ SimEngine test) | the app runs end to end with no detection code |
| 2.6 | Sim controls (sim mode only): `SIMULATED` chip, a small floating panel with **Pass** (also key `P`), auto on/off, lap speed (`?lap=<s>`, default 10–15 s random), "drop camera", "low fps" | `src/ui/sim/SimPanel.tsx` (lazy) | a tester can drive a whole session on a phone |
| 2.7 | Components at final style (spec §4.1–4.2): `TopBar` (`<nav>`, `aria-current`, ≥ 48 px), `BigButton` (hero circle, 300 ms double-tap guard), `ActionBar` (STOP; CONTINUE : END = 2 : 1), `StatusChip` (`role="status"`), `LapHero` (largest element, `aria-live="polite"`), `LapList` (newest 500 rows + "+N older", `content-visibility: auto`, best ★ + green), `Banner` (`role="alert"`), `Toast`, `ConfirmDialog` (native `<dialog>`, Cancel focused), `CameraLayer` (persistent `<video playsinline muted autoplay>`, front camera mirrored), `RoiOverlay`, `CameraErrorCard` (copy per spec §3.4), `SettingField` (number + −/+ + unit, % slider, select, toggle, segmented; help line, "changed" dot, inline error, `aria-describedby`) | `src/ui/components/*` (+ component tests: `LapList` best + cap, `SettingField` errors, `ConfirmDialog` focus) | each component visible in the gallery (2.11) |
| 2.8 | Screens: `Welcome` (GET READY, footer with version, install-link placeholder), `GetReady` (preview + ROI overlay with pass flash, health line, START), `Session` (status strip ARMING → STAND-BY → TIMING, `LapHero`, summary, `LapList`, STOP), `Paused` (reason banners, CONTINUE, END), `Configuration` (all groups generated from the schema, *Advanced* collapsed, ROI presets, draft / Save / discard dialog, Reset to defaults; "Test & calibrate" and "Diagnostics" as visual placeholders) | `src/ui/screens/*` | every §3.2 path clickable on a phone |
| 2.9 | Layouts: portrait; landscape / ≥ 768 px two columns; desktop centered max 1040; Welcome/Get Ready max 480 with START beside the preview in landscape | `src/ui/screens/*` | checked at 360, 768, 1280 px and landscape phone |
| 2.10 | Motion + input: `LazyMotion` + `domAnimation`, `MotionConfig reducedMotion="user"`, screen transitions, lap slide + list layout animation, single best pulse, dialog scale, press scale + `vibrate(20)`, reduced-motion variants (spec §4.4); keyboard: `Space`/`Enter` = visible primary action, `Esc` closes dialogs, Tab order, desktop key hints | `src/ui/motion.ts`, `src/ui/useKeyboard.ts` | no layout shift on lap update; full flow by keyboard |
| 2.11 | **State gallery** for review: `?state=<preset>` boots straight into a state, `?gallery` lists all presets as links. Presets: welcome, getReady, each camera error, session standby / timing / latest-is-best / 600 laps, paused user / hidden / cameraLost, every dialog, config clean / dirty / invalid, low fps, "tap to enable sound", wake-lock banner, storage toast, install hint, update toast | `src/ui/gallery/*` (lazy, not in the initial bundle) | every state from spec §3.4 can be opened by URL on a phone |
| 2.12 | E2E in sim mode: flow 1 (GET READY → START → N laps, best highlighted), flow 2 (STOP/CONTINUE keeps laps and drops the in-progress lap; END with laps → dialog, Cancel keeps the session), flow 3 (config edit → New session → discard dialog; Save survives reload); axe scan of every gallery preset (Chromium + WebKit); WebKit layout smoke | `e2e/*.spec.ts` | green in CI; 0 serious axe issues |

**M2 exit:** the Pages URL shows the complete, clickable app in simulation mode on Android, iPhone (browser + home screen) and desktop; every §3.2 row has a passing test; initial JS within budget.

## 5. M3 — UX review → freeze

| # | Task | Output | Done when |
|---|---|---|---|
| 3.1 | Device review from the Pages URL with a checklist: portrait/landscape, safe areas in standalone, notch/home indicator, readability of the latest lap at 3 m, bright light / outdoor, touch targets with gloves-off one hand, motion feel, reduced motion, keyboard on desktop, every gallery state | `docs/final/UX-REVIEW-v1.0.0.md` | Android, iPhone (browser + installed), macOS reviewed |
| 3.2 | Iterate on findings (one PR per round, each deployed) | PRs | no open "must fix" items |
| 3.3 | Real-camera preview check: Get Ready preview, mirroring, iOS installed-PWA camera re-prompt behaviour (spec risk §6.2) | notes in the review doc | behaviour known and the guide text drafted |
| 3.4 | Freeze: update spec §3/§4 where the UX changed; Playwright script captures every gallery preset as screenshots (reused for the manifest in M9) | spec diff, `docs/final/ux/*.png`, `e2e/tools/screenshots.ts` | UX signed off by you |

**M3 exit:** UX frozen. Later milestones change behaviour, not layout, unless a review item is reopened.

## 6. M4 — Engine port

No UI work. Can run in parallel with M2/M3. Order: types and pure modules (with ported tests) first, then browser glue, then the engine and debug page.

| # | Task | Files | Done when |
|---|---|---|---|
| 4.1 | Engine types exactly as spec §5.2 (`Settings`, `FrameMeta`, `MotionSample`, `DetectorEvent`, `PassEvent`, `FrameSource`, `FrameAnalyzer`, `DetectorEngine`, `CameraError`, …). Created at the start of M2 if M2 runs first, since the sim implements them | `src/engine/types.ts` | compiles; no DOM types outside `FrameSource.video` |
| 4.2 | Port `detector.js` 1:1 to TS (`createDetector(settings)` → `{ update(sample), reset(t), state }`), reading the passed settings object instead of the global `config`. Port every test of `test/detector.test.js` incl. the `seq()` helper | `src/engine/detector.ts` (+ `.test.ts`) | all ported cases green, behaviour unchanged |
| 4.3 | Port `toLuma`/`diffLuma` and `calibrate` (+ `MIN_START`) with their tests | `src/engine/motion-core.ts`, `calibration.ts` (+ tests) | ported tests green |
| 4.4 | Synthetic frame helper: luma frames with a dark blob crossing a bright noisy background; through motion-core + detector assert exactly N passes at 10/20/30/60 fps | `src/engine/test/synthetic.ts`, `pipeline.test.ts` | N passes at every fps |
| 4.5 | `FrameAnalyzer` from `createMotion`: injected canvas factory (DOM canvas now, `OffscreenCanvas` later), ROI crop to `processingMaxSize`, `readbackHint` canvases recreated on change, luma buffers swapped, global guard (80×60, ROI masked), **reset on frame-size or ROI change → next frame neutral**, per-stage timings for the HUD | `src/engine/browser/frame-analyzer.ts` | fake-canvas test: size change gives a neutral frame; manual: ratio moves on hand wave |
| 4.6 | `CameraSource`: constraints per spec §2.1; `deviceId` exact → `facingMode` → any camera; `fpsExact` `OverconstrainedError` → retry with `ideal` and report `fpsFallback`; error → `CameraError.kind` mapping; `isSecureContext` check; rVFC loop with rAF fallback; `stop()` cancels rVFC/rAF and stops tracks; `FrameMeta` (`dropped`, `gapReset`, `tSource`); track `ended` → `onEnded`; `applyExposure`/`applyFocus` via `applyConstraints` and report `getCapabilities`/`getSettings`; `listCameras()` + `devicechange` | `src/engine/browser/camera-source.ts` (+ unit test of error mapping and fallback chain with a mocked `mediaDevices`) | camera starts on Android/iOS/desktop; after `stop()` no tracks live and no callbacks fire |
| 4.7 | `FileSource`: object URL, `mediaTime·1000`, seek/loop → `seeked` | `src/engine/browser/file-source.ts` | a clip replays with identical events twice |
| 4.8 | `DetectorEngine`: source → analyzer → detector; run id bumped on `stop()`/`reset()` so late events are dropped; `stop()` synchronous; `reset()` → warm-up; `update()` for live tuning; emits `pass` **only for accepted `MOTION_END`** (D1), plus `phase`, `event`, `sample`; `stats()` (processed fps EMA, delivered fps, dropped, ms/frame p95) | `src/engine/engine.ts` (+ integration tests with fake source/analyzer) | no events after `stop()`; SUPPRESSED/REJECTED never produce `pass`; size change → neutral; warm-up after `reset()` |
| 4.9 | `replay.ts` (feed frames-CSV rows to detector + lap logic) and port `recorder.js` (debug CSV export). Golden tests over the M0 fixtures (pass count + lap list snapshot); a synthetic CSV until M0 lands | `src/engine/replay.ts`, `recorder.ts` (+ tests) | golden tests green |
| 4.10 | Minimal unstyled `?debug=1` page: video, ratio readout, phase, event log, HUD (fps, delivered, ms/frame, tSource), file replay, CSV export | `src/ui/debug/*` (lazy chunk) | usable on a phone for parity checks |
| 4.11 | Parity + perf check: same clip through PoC and v1 `FileSource` → compare events CSV; reference Samsung at defaults | notes in PR | same events; ≥ 27 processed fps; ≤ 15 ms/frame p95 |

**M4 exit:** all ported PoC tests green; reference Samsung ≥ 27 fps; same events as the PoC on a replayed clip; `stop()` leaves no rVFC or tracks running.

## 7. M5 — Real detection in the app

| # | Task | Files | Done when |
|---|---|---|---|
| 5.1 | Real `Effects`: `CameraSource` + `DetectorEngine` plugged into the effect runner. Simulation becomes opt-in (`?sim=1`); the gallery stays | `src/app/effects.ts`, `src/main.tsx` | the default build times real passes |
| 5.2 | Get Ready pass flash and camera health line from real engine events and stats (≤ 4 Hz) | `src/ui/screens/GetReady.tsx` | hand wave flashes the ROI border |
| 5.3 | Freeze detection defaults in the schema from M0.5 (per-platform defaults only if M0 shows a need) | `src/settings/schema.ts` | defaults match the findings |
| 5.4 | Synthetic e2e clip: script writes a `.y4m` (bright frame, dark square crossing every 4 s, 30 s, 30 fps, 240×480); Playwright Chromium gets the fake-camera flags | `e2e/tools/make-y4m.mjs`, `e2e/fixtures/laps.y4m`, `playwright.config.ts` | Chrome fake camera plays it; generated in CI if not committed |
| 5.5 | E2E flows 1–2 against the real pipeline (fake camera), alongside the sim versions | `e2e/session-real.spec.ts` | green in CI |
| 5.6 | Manual: 10 hand-wave laps on a phone from the Pages URL | — | lap times match a stopwatch within one frame |

**M5 exit:** e2e flows 1–2 pass on the real pipeline; manual hand-wave laps correct; detection defaults frozen.

## 8. M6 — Audio

| # | Task | Files | Done when |
|---|---|---|---|
| 6.1 | `unlock`: create/`resume()` `AudioContext` and prime `speechSynthesis` (speak `' '` at volume 0) inside GET READY, START, CONTINUE handlers; `navigator.audioSession.type = 'playback'` where available; track `suspended`/`interrupted` → store flag `audioLocked` | `src/audio/unlock.ts` | unlock runs inside the gesture (no `await` before it) |
| 6.2 | Cues per spec §2.3 (`armed`, `go`, `lap`, `best`, `paused`) as oscillator + gain envelopes | `src/audio/cues.ts` | each cue audible from Diagnostics |
| 6.3 | Speech: pick `en-*` + `localService` voice, `getVoices()` + `voiceschanged`, `cancel()` before each utterance, rate 1.1, `available` flag | `src/audio/speech.ts` | no backlog when laps come fast |
| 6.4 | Announcer: `(cue, lapMs, audioSettings) → { tone, text }` (pure, tested) + side-effect wrapper; respects `beep`/`voice`/`announceBest`. Replaces the logging audio effect (sim mode gets sound too) | `src/audio/announcer.ts` (+ test) | toggles and phrases tested |
| 6.5 | "Tap to enable sound" banner (built in M2) driven by `audioLocked`; next tap resumes | `src/app/effects.ts` | correct on iOS |
| 6.6 | Latency probe in debug: `MOTION_END` frame time vs speech `onstart` → p90 over the last 20 laps in the HUD | `src/ui/debug/Hud.tsx` | numbers visible on phone |
| 6.7 | Device check: Android Chrome, iPhone Safari + installed; silent switch behaviour for beep and speech noted | notes in PR | M6 exit met |

**M6 exit:** all cues heard on Android and iPhone (browser + installed); speech starts ≤ 500 ms after `MOTION_END` (p90 of 20 laps); toggles respected; no queued speech.

## 9. M7 — Configuration functionality

The form, draft model and dialogs exist since M2. This milestone connects them to real data.

| # | Task | Files | Done when |
|---|---|---|---|
| 7.1 | `migrate.ts`: PoC v1 flat keys → v2 groups, legacy keys like `minMotionFrames`/`showDisplay` dropped; `dronelap.ui.v1`; "can't be saved" toast on storage failure | `src/settings/migrate.ts`, `storage.ts` (+ tests with real PoC payloads) | PoC-saved settings migrate; corrupt JSON → defaults |
| 7.2 | Camera group: device picker (re-enumerate after grant and on `devicechange`), facing, exposure/focus capability "supported / not supported" and applied values from the last camera run | `Configuration.tsx`, `camera-source.ts` | capability shown per device |
| 7.3 | ROI presets drive the real analyzer (buffers resized); overlay matches the processed area | `RoiOverlay.tsx`, `frame-analyzer.ts` | switching a preset moves the overlay and the detection area |
| 7.4 | "Test & calibrate" (lazy): preview, ratio meter, pass flash, **Calibrate** (`calibration.durationMs`, `k`) writing `startRatio`/`endRatio` into the draft; uses `TUNE_START`/`TUNE_STOP` (§14) and `engine.update(draft.detection)` | `src/ui/config/TestCalibrate.tsx` | Calibrate updates the draft; camera stops when leaving Configuration |
| 7.5 | Diagnostics (`?debug=1`, lazy): move the M4 debug pieces here — `RatioGraph` (draws only while mounted), `DiffView`, `Hud`, `EventLog`, file replay, CSV export | `src/ui/debug/*` | no debug code in the initial bundle |
| 7.6 | E2E flow 3 on the real build (settings reach the engine after Save) | `e2e/config.spec.ts` | green in CI |

**M7 exit:** PoC settings migrate; invalid values can't be saved; Calibrate updates the draft; exposure capability shown per device.

## 10. M8 — Platform robustness

The banners and error cards exist since M2; this milestone makes the real conditions trigger them.

| # | Task | Files | Done when |
|---|---|---|---|
| 8.1 | Wake lock: acquire/release effects, re-acquire on `visible`, unsupported/rejected → banner (spec §2.2) | `src/platform/wake-lock.ts` | screen stays on for 10 min of session |
| 8.2 | Visibility: `visibilitychange` (+ `pagehide`) → `APP_HIDDEN`/`APP_VISIBLE`; auto-pause banner + `paused` cue | `src/platform/visibility.ts` | lock/unlock mid-session → Paused with banner; CONTINUE works |
| 8.3 | Track `ended` mid-session → `CAMERA_LOST` → Paused + banner + cue; CONTINUE retries | `effects.ts` | revoking permission mid-session pauses |
| 8.4 | Real camera errors → error cards: permission (`permissions.query` blocked vs not asked), not found (START hidden), busy, insecure context; overconstrained toast; saved `deviceId` gone → fallback and update selector | `src/platform/permissions.ts`, `effects.ts` | each error reproduced manually or mocked |
| 8.5 | Orientation: try `screen.orientation.lock('portrait')` when allowed; verify neutral frame on rotation (analyzer test from 4.5) | `src/platform/orientation.ts` | rotating while flat gives no pass |
| 8.6 | `beforeunload` prompt while the session has data | `effects.ts` | desktop reload with laps prompts |
| 8.7 | Low-fps chip from real stats: processed fps < 20 for 2 s | `effects.ts` | shown when throttling the clip |
| 8.8 | E2E flow 4 (permission denied → error card) and a visibility test (override `visibilityState` + dispatch event → Paused banner) | `e2e/platform.spec.ts` | green in CI |

**M8 exit:** every spec §3.4 row checked (manual or e2e); wake lock holds 10 min; lock/unlock pauses and CONTINUE works.

## 11. M9 — PWA offline + install

| # | Task | Files | Done when |
|---|---|---|---|
| 9.1 | `vite-plugin-pwa` (`generateSW`, `registerType: 'prompt'`) replaces the static manifest: manifest per spec §2.5, precache build assets + fonts, `navigateFallback: index.html` with `/poc/` denied, `cleanupOutdatedCaches`; `importScripts` a tiny `sw-cleanup.js` that deletes the PoC's `lap-counter-v1` cache on activate | `vite.config.ts`, `public/sw-cleanup.js` | built SW precaches the app only (no `poc/**`) |
| 9.2 | Icons with `@vite-pwa/assets-generator` from one SVG (192, 512, maskable 512, apple-touch 180); 2 manifest screenshots from the M3 script | `public/icon.svg`, `pwa-assets.config.ts` | Android install sheet shows screenshots |
| 9.3 | Update toast (built in M2) via `virtual:pwa-register/react`, shown only on Welcome/Configuration | `src/main.tsx` | never appears mid-session |
| 9.4 | Install: `beforeinstallprompt` → Welcome footer link; iOS one-time hint card (dismissal in `dronelap.ui.v1`); hidden in `display-mode: standalone` | `src/platform/install.ts` | correct on Android, iOS, installed |
| 9.5 | E2E flow 5: load, wait for SW, `context.setOffline(true)`, reload → app works | `e2e/offline.spec.ts` | green in CI |
| 9.6 | Lighthouse installable (local run) + airplane-mode cold start on Android and iOS | notes in PR | M9 exit met |

**M9 exit:** installable; airplane-mode cold start works after the first visit; update toast never mid-session; installs on Android and iOS.

## 12. M10 — Release hardening → v1.0.0

| # | Task | Output | Done when |
|---|---|---|---|
| 10.1 | Device-matrix checklist: 2 Samsung (Chrome), iPhone (Safari + installed), macOS Chrome/Safari; every §3.4 row; audio with silent switch; rotation while flat. Started from the M3 review doc and extended per milestone | `docs/final/TEST-CHECKLIST-v1.0.0.md` | all rows green |
| 10.2 | 30-min soak on the reference Samsung: HUD logs fps and (Chrome) heap every minute | soak CSV + notes | fps drift < 10 %, heap flat |
| 10.3 | Final visual pass with real sessions: latest lap readable at 3 m, no layout shift on real laps, axe 0 serious | notes | matches the frozen UX |
| 10.4 | Budgets: initial JS ≤ 130 KB gz, fonts ≤ 100 KB, coverage ≥ 90 % on `engine/`, `session/`, `settings/`, `app/machine.ts` | CI output | all within budget |
| 10.5 | User guide: setup, phone placement, calibration, troubleshooting (permissions, low fps, sound, Auto-Lock, max brightness), known limitations (false last lap near STOP) | `docs/final/USER-GUIDE.md`, root `README.md` | merged |
| 10.6 | `CHANGELOG.md`, version `1.0.0`, tag `v1.0.0`, deploy | tag + Pages | v1.0.0 live |

## 13. What can be tested on devices, by milestone

| After | On the Pages URL you can check |
|---|---|
| M1 | Shell, fonts, colours, safe areas, home-screen install (standalone) |
| M2 | The whole app: every screen, dialog, banner, error card (via `?gallery`), layouts, animations, keyboard — with simulated passes |
| M5 | Real lap timing with the camera (sim still at `?sim=1`) |
| M6 | Beeps and spoken times |
| M7 | Saved settings, calibration, camera choice |
| M8 | Auto-pause, wake lock, real camera errors |
| M9 | Offline use, install prompt, update toast |

## 14. Spec gaps resolved here [gap]

Each gets a reducer, engine or sim test.

| # | Situation | Decision |
|---|---|---|
| G1 | `CAMERA_LIVE` in Session after CONTINUE (camera was `starting`) | camera → `live`, effect `engine.start` (detector enters warm-up → `ARMED` later) |
| G2 | `CAMERA_ERROR` after CONTINUE (state is already Session/Arming) | back to Paused(`cameraLost`) with the error banner; `camera = {error}`. The spec's "Paused \| CAMERA_ERROR" row means this |
| G3 | `PASS` in GetReady | state unchanged; the effect runner flashes the ROI border via a separate UI signal (not a machine event) |
| G4 | `PASS` while `phase: 'arming'` | cannot happen (engine emits no passes in warm-up); reducer ignores it defensively |
| G5 | `APP_HIDDEN`/`APP_VISIBLE` on Welcome, Configuration (tuning off), Paused | no state change; wake lock re-acquire is handled in `platform/wake-lock.ts` |
| G6 | `APP_HIDDEN` on Configuration with Test & calibrate open | stop tuning camera/engine; resume on `APP_VISIBLE` only if the panel is still open |
| G7 | Live tuning ownership | new events `TUNE_START` / `TUNE_STOP` (Configuration only): effects `camera.start` → `engine.start` with draft detection settings / stop all. Leaving Configuration stops all. Keeps the machine the single owner of the camera |
| G8 | Settings used by `camera.start`/`engine.start` | always the **saved** settings, except tuning which uses the draft. The camera only runs in Configuration while tuning and is stopped on Save |
| G9 | `START` while the camera is `starting` or in error | ignored (guard "camera live"); START button disabled |
| G10 | Existing PoC SW at `/` before M9 | acceptable: it is network-first, so online visits get v1. M9's `sw-cleanup.js` removes its cache and the v1 SW takes over the scope |
| G11 | Simulation mode | default until M5, then `?sim=1`. `SimEngine` respects `warmupMs` and `cooldownMs` so UX timing feels real; `SIMULATED` chip always visible; sim code is a lazy chunk outside the initial budget |
| G12 | State gallery in production | kept (`?state=`, `?gallery`), lazy-loaded, sim-backed; it never touches saved settings (in-memory storage) |

## 15. Traceability

| Spec | Tasks |
|---|---|
| §1.5 reuse/refactor | 4.2–4.9, 2.4, 6.x, 7.1, 7.5, 9.1 |
| §2.1 camera | 4.6, 7.2, 8.4, 3.3 |
| §2.2 wake lock | 8.1 |
| §2.3 audio | 6.1–6.7 |
| §2.5 PWA shell | 1.3, 1.8, 9.1–9.4 |
| §2.6 persistence | 2.3, 7.1 |
| §2.7 deploy | 1.7 |
| §3.1 screens | 2.8 |
| §3.2 state machine | 2.2, 2.4, §14 |
| §3.3 lap semantics | 2.1 |
| §3.4 edge cases | 2.11 (visual), 8.1–8.8, 10.1 |
| §4 visual design | 1.3, 2.7–2.10, 3.1–3.4, 10.3 |
| §5.1 boundaries | 1.2 |
| §5.3–5.4 testing | 2.1–2.3, 2.7, 2.12, 4.2–4.9, 5.5, 7.6, 8.8, 9.5, 10.1 |
| §6.1 milestones | §1 mapping, §2–§12 |

## 16. Verification

- `cd app && npm run lint && npm run typecheck && npm test && npm run build && npm run size && npm run test:e2e` — the same stages as CI.
- `npm run dev` → `https://<lan-ip>:5173` on a phone (accept the dev cert) for quick local checks.
- Device testing: the Pages URL after each merge to `main`, or after a manual branch deploy (task 1.7). The footer shows version + git SHA. Useful URLs: `?gallery`, `?state=<preset>`, `?sim=1` (after M5), `?debug=1`, `/poc/`.
