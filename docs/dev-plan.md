# Drone Lap Counter — Dev Plan

> Status: plan, 2026-10-01. Source spec: [brainstorm.md](brainstorm.md) §4. Items marked **[gap]** clarify or extend the spec.

## 0. Ground rules
- Project lives in `drone-lap-poc/` (layout from brainstorm §4). Vanilla JS ES modules, Vite, `node:test`. No runtime dependencies; dev dependency is only `vite`.
- Every step ends in a working, runnable state plus a commit.
- Pure logic (`detector.js`, the diff core of `motion.js`, calibration math) has no DOM access, so it runs under `node --test`.
- PWA-safe from the start: `vite.config.js` uses `base: './'`, no Node APIs in `src/`, camera access only in `source.js`.

## 1. Phase 0 — Scaffold (≈0.5 h)
| # | Task | Done when |
|---|---|---|
| 0.1 | `drone-lap-poc/` with `package.json` (`dev`, `build`, `preview`, `test: node --test`), `vite.config.js` (`base: './'`), `index.html`, `style.css`, empty `src/*.js`, `.gitignore` (node_modules, dist) | `npm run dev` serves a blank page; `npm test` runs with 0 tests |

## 2. Phase 1 — Core (≈1.5–2 days)
Order: pure modules first (they come with tests), then browser glue.

| # | Task | Files | Done when |
|---|---|---|---|
| 1.1 | **Config:** `config` defaults + `roiPresets` exactly as in brainstorm §4. Add a `ROI` field (relative). Load/save goes in Phase 2; the shape is fixed now. | `config.js` | imported by the other modules |
| 1.2 | **Detector state machine** (pure): `createDetector(config)` → `{ update(sample) → events[], reset(t), state }`. States: WARMUP, IDLE, CANDIDATE, MOTION. Events: `MOTION_START`, `MOTION_END`, `SUPPRESSED`, `REJECTED`. Keep a pass record (`startT`, `peakT`, `peakRatio`, `frames`, `prevStartT`, `prevPeakT`) and attach `dStart` / `dPeak`. | `detector.js` | 1.3 tests pass |
| 1.3 | **Detector tests:** all 8 cases from brainstorm §Testing, plus the [gap] cases below. Use a helper `seq([...ratios], {fps, global})` to build sample streams. | `test/detector.test.js` | `npm test` passes |
| 1.4 | **Motion core** (pure): `toLuma(rgba, out) → mean`, `diffLuma(curr, prev, meanCurr, meanPrev, opts, mask?) → changedCount` and optionally writes a debug mask. Buffers are allocated by the caller. | `motion.js` | 1.5 tests pass |
| 1.5 | **Motion tests:** identical frames → 0; uniform +30 brightness with normalisation on → 0, off → 100%; one 10×10 block changed → exact ratio; exclusion mask respected. | `test/motion.test.js` | pass |
| 1.6 | **Motion canvas glue:** `createMotion(config)` → `process(video, roi) → { ratio, globalRatio, global }`. ROI crop at full resolution through `drawImage`; processing size has longest side ≤ `processingMaxSize`; `willReadFrequently`; two luma buffers **swapped, not copied**; buffers reallocated only when ROI or size changes. Global guard (80×60 full frame, ROI excluded via precomputed mask) is wired in now behind a flag. Phase 2 tests and exposes it. | `motion.js` | ratio is visible in the console |
| 1.7 | **Source:** `listCameras()`, `startCamera(deviceId)` with the 1280×720@60 ideal constraints, `onFrame(cb)` using rVFC (fallback: rAF + `currentTime` change check). Pass `{ t, mediaTime, dropped, gapReset }` to `cb`. Dropped frames come from `presentedFrames` gaps; `gapReset` when the gap is > `resetGapMs`. Re-run `enumerateDevices` after permission is granted, because labels are empty before that. | `source.js` | frames log at camera rate, not display rate |
| 1.8 | **UI wiring:** camera select + Start Camera, Start/Stop Detection, preview canvas with ROI overlay (outside area dimmed), diff canvas, live stats (state, ratio %, thresholds, processed FPS, dropped, pass count, last pass), event log in the brainstorm format, Clear, config inputs generated from the `config` keys (number/checkbox) and applied live. ROI x/y/w/h inputs. | `main.js`, `index.html`, `style.css` | brainstorm Phase 1 check: static ceiling → no events; hand wave → one START + END |

**Phase 1 exit:** manual check passes, `npm test` is green, commit.

## 3. Phase 2 — Tuning tools (≈1.5 days)
| # | Task | Done when |
|---|---|---|
| 2.1 | **Video-file source:** `<input type="file">` → object URL → same `onFrame` pipeline. **[gap]** For files, the timestamp is `mediaTime * 1000`, not wall clock, so lap Δs don't depend on decode speed. Seek or loop → `detector.reset()` + previous frame dropped. | a recorded clip replays and gives the same events on two runs |
| 2.2 | **Ratio graph:** ring buffer (~10 s × 60 fps), canvas line plot with startRatio/endRatio lines, MOTION periods shaded, global frames marked. Redraw on rAF, decoupled from processing. | graph tracks a hand wave |
| 2.3 | **Global guard:** expose `globalRatio` in stats and the log; detector treats `global` frames as neutral. | lights on/off → no pass, frames flagged |
| 2.4 | **Calibration** (pure helper `calibrate(ratios, k)` + test): `startRatio = max(mean + kσ, 1.2·max, MIN_START)`, `endRatio = startRatio/2`. Show mean/σ/max and the chosen values; hint if mean > 1%. **[gap]** Floor `MIN_START` (e.g. 0.002), because a perfectly static scene gives 0 → a single pixel would trigger. Global frames are excluded from the samples. | static scene → thresholds set; hand wave still detected |
| 2.5 | **ROI presets** dropdown (box / vLine / hLine) feeding the x/y/w/h inputs. | switching a preset moves the overlay and resizes buffers |
| 2.6 | **Beep:** Web Audio oscillator, ~60 ms, on `MOTION_START`; AudioContext created/resumed on first click; mute toggle. | beep on a hand wave |
| 2.7 | **CSV export:** events CSV + per-frame CSV (`t, ratio, globalRatio, global, state`). Per-frame rows in a capped array (e.g. 200k rows ≈ 55 min @ 60 fps). Download via Blob. | files open in a spreadsheet |
| 2.8 | **localStorage:** save config + ROI on change, load on start, with `try/catch` and a "Reset defaults" button. | settings survive a reload |
| 2.9 | **README:** run instructions (macOS), camera permissions (browser + System Settings → Privacy & Security → Camera), algorithm and state-machine summary, parameter table, how to run tests, test scenarios. The Findings section is left as a placeholder. | deliverables 2–7 covered |

**Phase 2 exit:** all controls work live, commit.

## 4. Phase 3 — Evaluate (≈1 day, needs the real setup)
1. Run manual scenarios 1–6 from brainstorm §Testing; export a CSV for each.
2. Collect the metrics from brainstorm §Metrics (idle mean/max, peak, SNR, misses, false starts, suppressed/rejected, FPS, dropped, Δstart vs Δpeak spread).
3. Check the success criteria (5 min static → 0; lights → 0; 20 tosses → ≥19, 0 doubles; 10 whoop laps → 10 passes).
4. Write README **Findings**: measured numbers, recommended defaults, which lap timestamp to use (answers §7), and whether any §5 backlog item is justified.
5. Update the `config.js` defaults to the recommended values.

## 5. Detector spec clarifications [gap]
These are decided here so the tests can be written. Each one gets a test:
- **CANDIDATE + global frame:** neutral. It doesn't count toward `minMotionFrames` and doesn't reset to IDLE.
- **CANDIDATE + `endRatio ≤ ratio < startRatio`:** back to IDLE (strict confirmation).
- **SUPPRESSED pass** still follows `maxMotionMs` and end rules, but emits no `MOTION_END`; it ends silently (or emits `SUPPRESSED_END` for the log). It doesn't update `prevStartT`.
- **Cooldown** is measured from the last *accepted* backdated `startT`.
- **REJECTED** resets the pass but keeps `prevStartT`.
- **`gapReset` frame:** treated as global/neutral (no diff available).
- **`maxMotionMs`** is measured on `t`, so global frames inside a pass still count toward it.
- `reset(t)` puts the detector back in WARMUP until `t + warmupMs`. It's called on start detection, source change and seek.

## 6. Risks to watch during the build
- `metadata.captureTime` is missing on Safari and on file sources. Fall back as described, and show the timestamp source in stats.
- Continuity Camera may ignore 60 fps. Show the actual `track.getSettings()` in stats.
- Allocating per frame causes GC jank. Check in DevTools Performance during Phase 1 exit.
- iPhone HEVC files don't play in Chrome. Document "Most Compatible" in the README.

## 7. Verification
- `cd drone-lap-poc && npm test`: detector, motion core and calibration tests are green.
- `npm run dev` → Chrome on macOS: Phase 1 hand-wave check, then Phase 2 checks per row, then Phase 3 scenarios.
- `npm run build && npm run preview`: works from `dist/` with relative paths (PWA-readiness smoke test).
