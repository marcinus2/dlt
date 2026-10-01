# Drone Lap Counter PoC

Browser proof of concept that counts drone passes by detecting motion in a region of interest (ROI) of a camera or video file. Vanilla JS ES modules, Vite, no runtime dependencies. Spec: [../docs/brainstorm.md](../docs/brainstorm.md), plan: [../docs/dev-plan.md](../docs/dev-plan.md).

## Run (macOS)
```sh
npm install
npm run dev        # http://localhost:5173 (Chrome recommended)
npm run build && npm run preview   # production build from dist/, relative paths
npm test           # unit tests (node --test)
```
`localhost` counts as a secure context, so the camera works without HTTPS.

## Camera access
1. Click **Start Camera** and allow the prompt (Chrome: lock icon next to the URL → Site settings → Camera).
2. If the page gets no video or the prompt never appears: **System Settings → Privacy & Security → Camera** and enable your browser.
3. Camera labels are empty until permission is granted; the list refreshes after you allow it.
4. Continuity Camera (iPhone) may ignore 60 fps. The actual resolution and frame rate are shown in the stats.

## Using it
- **Source:** *Start Camera*, or *or file* to load a recorded clip (it loops; loop/seek resets the detector). File timestamps are `mediaTime`, so the same clip gives the same events on every run. iPhone clips must be H.264 (Settings → Camera → Formats → *Most Compatible*), because Chrome doesn't play HEVC.
- **Detection:** *Start Detection* / *Stop Detection*. Warm-up (`warmupMs`) ignores the first frames.
- **Calibrate:** keep the scene static for `calibrationMs`; sets `startRatio` / `endRatio` and logs mean / σ / max.
- **Views:** camera + ROI (outside area dimmed), diff mask of the ROI, ratio graph (last ~12 s: dashed start/end lines, green = MOTION, pink ticks = global frames).
- **ROI:** preset dropdown (full / box / vLine / hLine) and x/y/w/h inputs (relative 0–1).
- **Beep** on `MOTION_START` (audio unlocks on the first click), **mute** toggle.
- **Export:** *events CSV* and *frames CSV* (`t, ratio, globalRatio, global, state`; up to 200k rows ≈ 55 min @ 60 fps; detection start clears them).
- Config and ROI are saved to localStorage on change. *Reset defaults* clears them.

## Algorithm
Per camera frame (`requestVideoFrameCallback`, fallback rAF):
1. Crop the ROI from the full-resolution video into a canvas scaled so the longest side ≤ `processingMaxSize`.
2. Convert to luma (`(77r + 150g + 29b) >> 8`) in reused buffers (swapped, not copied).
3. With `brightnessNormalize`, subtract the mean luma shift between frames, which cancels flicker and exposure drift.
4. A pixel changed if `|curr − prev − offset| > pixelDiffThreshold`; `ratio = changed / pixels`.
5. **Global guard:** the full frame at 80×60, ROI excluded, diffed the same way → `globalRatio`. Above `globalGuardRatio` the frame is flagged `global` (light switch, camera bump). Frames with no previous frame (first, after reset or ROI change) are also neutral.

### Detector state machine (`src/detector.js`, pure)
```
WARMUP ──warmupMs──▶ IDLE ──ratio ≥ start──▶ CANDIDATE ──minMotionFrames──▶ MOTION ──endHoldFrames quiet──▶ IDLE
                      ▲                          │ ratio < start                │ t > maxMotionMs
                      └──────────────────────────┘                              ▼
                                                              REJECTED → IDLE (re-arm after endHoldFrames quiet frames)
```
- `MOTION_START` is backdated to the first motion frame. Within `cooldownMs` of the last accepted start the pass is `SUPPRESSED` instead (still tracked to its end, no `MOTION_END`).
- Quiet = `ratio < endRatio` (hysteresis). `MOTION_END` is stamped at the last active frame.
- `global` and gap frames are neutral everywhere: they never start motion, confirm, or count toward the end hold.
- Events carry `dStart` / `dPeak`, the time since the previous accepted pass's start / peak.
- All rules and their tests: dev-plan §5, `test/detector.test.js`.

## Parameters (`src/config.js`, all editable live)
| Key | Default | Meaning |
|---|---|---|
| `cameraWidth` / `cameraHeight` | 240 / 480 | requested camera size; readback cost scales with it (applied on Start Camera) |
| `exposureManual` / `exposureTime` | true / 100 | lock exposure at `exposureTime` × 100 µs so the camera holds its frame rate (Android Chrome) |
| `focusLock` | false | freeze autofocus at its current distance |
| `cameraFps` / `fpsExact` | 30 / false | requested frame rate; `fpsExact` fails instead of falling back |
| `globalGuard` | false | full-frame guard (a second video readback per frame) |
| `showDisplay` | true | preview, diff view and graph; off = less CPU |
| `readbackHint` | true | CPU-backed (`willReadFrequently`) readback canvases; off = GPU canvases |
| `processingMaxSize` | 320 | longest side of the processed ROI (px) |
| `pixelDiffThreshold` | 10 | min luma change for a pixel to count |
| `brightnessNormalize` | false | cancel global brightness shift |
| `globalGuardRatio` | 0.2 | outside-ROI change fraction that flags a frame as global |
| `startRatio` | 0.02 | ROI fraction to start motion |
| `endRatio` | 0.01 | ROI fraction below which motion may end |
| `minMotionFrames` | 2 | consecutive frames to confirm a start |
| `endHoldFrames` | 3 | consecutive quiet frames to confirm an end |
| `cooldownMs` | 1500 | min gap between accepted starts |
| `maxMotionMs` | 3000 | longer motion is rejected |
| `warmupMs` | 1500 | ignore after start (auto-exposure settling) |
| `resetGapMs` | 250 | frame gap that resets the previous frame |
| `calibrationMs` | 3000 | calibration sampling time |
| `calibrationK` | 5 | σ multiplier in calibration |
| `roi` | full frame | x / y / width / height, relative 0–1 |

Calibration: `startRatio = max(mean + k·σ, 1.2·max, 0.002)`, `endRatio = startRatio / 2`. The 0.002 floor stops a perfectly static scene (all zeros) from triggering on a single pixel. Global frames are excluded from the samples. If the idle mean is above 1%, raise `pixelDiffThreshold` or fix lighting first.

## PWA
`public/manifest.webmanifest` + `public/sw.js` (hand-written, no dependencies; network-first with cache fallback, registered in production builds only by `src/pwa.js`). Needs HTTPS: deploy `dist/` to a static host, open it in Android Chrome, then menu → Install app. After one online visit it opens offline. Bump `CACHE` in `sw.js` to drop old caches.

## Tests
`npm test` runs `node --test` on `test/`: detector (state machine and the dev-plan §5 rules), motion core (luma, diff, normalisation, exclusion mask), calibration, recorder/CSV and storage. Canvas and camera glue is checked manually.

## Test scenarios (manual, macOS)
1. Camera at the ceiling, static, 60 s → 0 events; note the idle ratio.
2. Calibrate.
3. Toss a small object (crumpled paper, ~5 cm) across the ROI ×20 → count detections.
4. Room lights on/off, switch a lamp on → no pass counted (frames flagged global).
5. Real whoop: record 10 laps with a phone flat on the floor (H.264), load the file and compare; or use the iPhone live via Continuity Camera.
6. Repeat at 60 fps if available.

Metrics to note: idle mean/max, peak per pass, SNR = peak / idle max, misses, false starts, suppressed / rejected, FPS, dropped frames, Δstart vs Δpeak spread.

## Findings
_To be filled in after Phase 3 (measured numbers, recommended defaults, which timestamp to use for laps)._
