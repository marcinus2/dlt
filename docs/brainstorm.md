# Drone Lap Counter — Brainstorm & PoC Prompt v2

> Status: brainstorm, 2026-10-01. Replaces [PR.md](PR.md) as the PoC prompt.
> Sections 1–3 = context and decisions. Section 4 = the prompt to execute. Sections 5–7 = backlog and open points.

---

## 1. Decisions

| Topic | Decision |
|---|---|
| Drone | Tiny whoop (65–75 mm, indoor, roughly 3–8 m/s) |
| Camera view | Pointing up at the ceiling (phone flat on the floor; for the PoC, a laptop lid tilted back or an iPhone as Continuity Camera) |
| Placement | Under a **slow** part of the track (corner/apex), not a straight |
| Use case | Solo practice, one pilot. "Good enough" accuracy (about one frame, ±33 ms at 30 fps) |
| Future | PWA for Android + iOS. The PoC is **not** a PWA but must not block one (see §6) |

## 2. Target scenario — rough numbers

Assumptions: camera about 1.5 m below the flight line, about 75° FOV.

| Quantity | Value | Consequence |
|---|---|---|
| Visible width at drone height | ≈ 2.3 m | — |
| Drone size at 1280 px source | ≈ 40 px | OK |
| Drone size if whole frame shrunk to 320 px | ≈ 10 px | Too small → **crop the ROI at full resolution** |
| Movement at 3 m/s, 30 fps | ≈ 10 cm/frame | Drone visible about 20 frames in full view, 3–5 frames in a 15%-wide strip |
| Indoor lap time | ≈ 5–20 s | `cooldownMs` 1500 is safe |
| Timing resolution | 33 ms @ 30 fps, 17 ms @ 60 fps | Fine for solo practice |

## 3. Ceiling-specific risks

Good news: the drone shows up as a **dark shape on a bright, plain background**, so contrast is high, and people are mostly out of view.

| Risk | Mitigation (in PoC) |
|---|---|
| Light flicker (50 Hz mains → 100 Hz flicker beating against 30 fps) → whole frame pulses in brightness | Brightness normalisation + global-change guard |
| Lamp inside the ROI: blown out, noisy edges, auto-exposure jumps when the drone crosses it | Place the ROI away from lamps; global guard; warm-up. (Mask → backlog) |
| Auto-exposure settling after camera start | `warmupMs` |
| Ceiling fan, AC vent, hanging objects | Keep them out of the ROI |
| Lights switched on/off | Global guard → frame flagged, no pass counted |

---

## 4. PoC Prompt v2

### Goal
Build a minimal browser PoC (macOS; built-in webcam, external webcam or iPhone Continuity Camera) that detects **when motion appears in a region of the image** using frame differencing.

Question to answer: *Is frame differencing good enough to detect a tiny whoop passing above a camera pointed at the ceiling?*

Long-term use: a phone lying on the floor times laps; each detected pass = a possible lap. No drone/object recognition, only "enough change happened in the ROI".

### Stack & constraints
- **Use:** HTML, CSS, vanilla JS (ES modules), `getUserMedia()`, `<video>`, `<canvas>`, minimal Vite project (no framework).
- **Tests:** `node:test` (built into Node), no extra dependencies.
- **Do not use/implement:** backend, PWA (manifest/service worker), React, TypeScript, DB, auth, ML/AI, object detection, OpenCV(.js), MediaPipe, cloud, deployment, full race logic.
- **Keep it PWA-friendly:** no Node APIs in browser code, relative asset paths, nothing tied to localhost, camera code isolated in one module.
- Keep code simple and easy to extend. Reuse buffers; no large array copies per frame.

```
drone-lap-poc/
├── index.html
├── style.css
├── src/
│   ├── main.js        # UI wiring, render/debug views, log, audio
│   ├── config.js      # config + ROI presets, localStorage load/save
│   ├── source.js      # camera / video-file source, per-frame callback
│   ├── motion.js      # ROI crop + frame diff → { ratio, globalRatio } (pure, reused buffers)
│   └── detector.js    # state machine: update(sample) → events (pure, no DOM)
├── test/
│   └── detector.test.js
├── package.json
└── README.md
```

### Frame loop (`source.js`)
- Request `{ width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } }`; let the user pick a camera (`enumerateDevices`) so Continuity Camera / an external webcam can be used.
- Process **each camera frame exactly once** with `video.requestVideoFrameCallback()`.
  - Why: `requestAnimationFrame` runs at display rate (60–120 Hz) while the camera gives 30 fps, so the same frame would be compared with itself → ratio 0 every other frame → false `MOTION END`s.
  - Fallback: rAF + skip if `video.currentTime` hasn't changed.
- Timestamp = `metadata.captureTime` if present, else the callback's `now` (both use the `performance.now()` clock).
- Count dropped frames from gaps in `metadata.presentedFrames`.
- If the gap since the last processed frame is > `resetGapMs` (tab hidden, stall), drop the previous frame and skip the diff for this one.
- Same pipeline for a **video file** (`<input type="file">`) so recorded sessions can be replayed for tuning.

### Motion algorithm (`motion.js`)
Per frame:
1. **Crop the ROI from the full-resolution video:** `drawImage(video, sx, sy, sw, sh, 0, 0, pw, ph)`, where the processing size keeps the aspect ratio and its longest side is ≤ `processingMaxSize`. Use `getContext('2d', { willReadFrequently: true })`.
2. Convert to luma in a reused `Uint8Array`: `(77*r + 150*g + 29*b) >> 8`.
3. **Brightness normalisation** (toggle, default on): `offset = mean(curr) − mean(prev)`, `d = |curr − prev − offset|`. Cancels flicker and exposure drift.
4. A pixel is changed if `d > pixelDiffThreshold`. `ratio = changed / total`.
5. **Global guard:** draw the full frame at about 80×60, diff it the same way **excluding the ROI area** → `globalRatio`. If `globalRatio > globalGuardRatio`, flag the frame `global: true` (camera bump, lights, exposure jump).
6. Write the changed-pixel mask to the debug diff canvas.

Output: `{ t, ratio, globalRatio, global }`.

### Detector state machine (`detector.js`, pure)
Input: `update({ t, ratio, global })` → array of events. Rules:

- **WARMUP:** ignore everything for `warmupMs` after start/reset.
- **IDLE → CANDIDATE:** `ratio ≥ startRatio` and not `global`. Remember `firstT`.
- **CANDIDATE → MOTION:** `minMotionFrames` frames in a row with `ratio ≥ startRatio`. Otherwise go back to IDLE.
  - Emit `MOTION_START` with **`t = firstT` (backdated)**, not the moment it was confirmed.
  - If within `cooldownMs` of the last **accepted START** → emit `SUPPRESSED` instead and still track the pass to its end (so it can't re-trigger).
- **MOTION:** track `peakRatio`, `peakT`, `frames`.
  - **Hysteresis + end debounce:** end only after `endHoldFrames` frames in a row with `ratio < endRatio` → emit `MOTION_END { startT, endT, durationMs, peakT, peakRatio, frames }`.
  - If duration > `maxMotionMs` → emit `REJECTED (LONG_MOTION)` → IDLE.
- `global` frames are **neutral**: they don't start motion, don't count toward end-hold, and don't update the peak.
- Keep a pass record so a lap is easy to add later. On each accepted START, log `Δstart = startT − prevStartT`; on END, also log `Δpeak = peakT − prevPeakT`. (Which one makes the better lap timestamp is decided from Phase 3 data.)

### Config (`config.js`, single object, tunable at runtime, saved to localStorage)
```js
export const config = {
  // motion
  processingMaxSize: 320,      // longest side of the processed ROI (px)
  pixelDiffThreshold: 25,      // min luma change per pixel
  brightnessNormalize: true,   // cancel global brightness shift
  globalGuardRatio: 0.2,       // outside-ROI change fraction that flags a frame as global
  // detector
  startRatio: 0.02,            // ROI fraction to start motion
  endRatio: 0.01,              // ROI fraction below which motion may end (hysteresis)
  minMotionFrames: 2,          // consecutive frames to confirm a start
  endHoldFrames: 3,            // consecutive quiet frames to confirm an end
  cooldownMs: 1500,            // min gap between accepted STARTs
  maxMotionMs: 3000,           // longer motion = rejected (not a drone pass)
  warmupMs: 1500,              // ignore after start (auto-exposure settling)
  resetGapMs: 250,             // frame gap that resets the previous frame
  // calibration
  calibrationMs: 3000,
  calibrationK: 5,
};

export const roiPresets = {           // relative 0–1
  box:   { x: 0.2,   y: 0.25,  width: 0.6,  height: 0.5  },
  vLine: { x: 0.425, y: 0.1,   width: 0.15, height: 0.8  }, // virtual finish line
  hLine: { x: 0.1,   y: 0.425, width: 0.8,  height: 0.15 },
};
```
Defaults are starting points only; **Calibrate** should replace them.

### Calibration
Button **Calibrate (static scene)**: collect `ratio` for `calibrationMs` →
- `startRatio = max(mean + k·σ, 1.2 · maxIdle)`, `endRatio = startRatio / 2`.
- Show mean / σ / max and the chosen values.
- If idle mean is > 1%, show a hint to raise `pixelDiffThreshold` first.

### UI
- **Source:** camera select + `Start Camera`, `Load Video File`.
- **Detection:** `Start Detection`, `Stop Detection`, `Calibrate`.
- **Views:**
  - Camera preview with ROI overlay (outside-ROI guard area dimmed).
  - Debug diff canvas (changed pixels only), which is essential.
  - **Ratio graph:** last ~10 s, with `startRatio`/`endRatio` lines, motion periods shaded, global frames marked.
- **Live stats:** state, ratio %, start/end thresholds %, processed FPS, dropped frames, rolling idle mean/max, last pass peak + duration + frames, pass count.
- **Controls:** every config field, ROI preset + x/y/w/h inputs, normalisation toggle, mute.
- **Audio:** short beep on `MOTION_START` (Web Audio, unlocked on first click). You watch the drone, not the screen.
- **Event log**, e.g.:
  ```
  13:42:10.231  MOTION START   Δstart 7.412 s
  13:42:10.411  MOTION END     dur 180 ms  peak 6.3%  frames 6  Δpeak 7.398 s
  13:42:11.020  SUPPRESSED     (cooldown)
  13:42:15.900  REJECTED       long motion 3.0 s
  ```
  `Export CSV` (events + per-frame `t, ratio, globalRatio, state`), `Clear`.

### Workflow (phased; ship each phase working)
1. **Core:** camera source with rVFC, `motion.js` (crop, luma, normalisation, diff), `detector.js` + unit tests, preview + ROI, diff view, status, log, config inputs. Check: static ceiling gives no events; a hand wave gives one START/END.
2. **Tuning tools:** video-file source, ratio graph, calibration, beep, global guard, ROI presets, CSV export, localStorage.
3. **Evaluate:** run the test scenarios, collect the metrics, write the findings + recommended defaults into README.

Don't over-engineer; no complex CV pipeline. Anything from §5 only if Phase 3 data justifies it.

### Testing
**Unit (`node --test`)**: synthetic `{t, ratio, global}` sequences for `detector.js`:
- clean pass → exactly 1 START + 1 END
- pass with a 1-frame dip → still 1 pass
- 1-frame noise spike → nothing
- 2 passes within cooldown → 1 accepted + 1 SUPPRESSED
- motion > `maxMotionMs` → REJECTED
- `global` frames → no START
- events during warm-up are ignored
- START timestamp equals the first motion frame (backdated)

**Manual (macOS)**:
1. Camera at the ceiling, static, 60 s → 0 events. Note the idle ratio.
2. Calibrate.
3. Toss a small object (crumpled paper about 5 cm) across the ROI ×20 → count detections.
4. Turn room lights on/off; switch a lamp on → no pass counted (global flag).
5. Real whoop: phone flat on the floor recording video (iPhone: Formats → "Most Compatible" = H.264 so Chrome can play it; 30 or 60 fps), fly 10 laps, load the file → compare. Or use the iPhone live via Continuity Camera.
6. Repeat at 60 fps if available.

### Metrics to observe
Idle ratio mean/max · peak ratio per pass · **SNR = peak / idle max** · detections per pass · missed passes · false starts · suppressed / rejected counts · event duration and frames per pass · processed FPS · dropped frames · lap Δ spread on steady laps, `Δstart` vs `Δpeak` (lower spread = better timestamp).

### Deliverables
1. Complete project code (phases 1–2).
2. macOS run instructions.
3. How to grant camera access (Chrome/Safari site permission + macOS System Settings → Privacy & Security → Camera).
4. Short explanation of the algorithm and state machine.
5. List of tunable parameters.
6. Unit tests + how to run them.
7. Test scenarios (above).
8. README "Findings" section: measured metrics + recommended defaults for the ceiling/whoop setup.

### Success criteria
- Static ceiling for 5 min → 0 passes.
- Lights toggled / flicker → no pass counted.
- 20 tosses → ≥ 19 detected, 0 double counts.
- Recorded whoop session, 10 laps → 10 passes, plausible lap Δs.
- Calibration produces usable thresholds without manual tuning; all parameters adjustable live.

---

## 5. Backlog — after the PoC

**Detection (only if Phase 3 metrics show a need):**
- Block compactness check: split the diff mask into 8×8 cells and count cells > 30% changed. Noise spreads thinly; a drone concentrates in a few cells. Cheap stand-in for blob detection.
- Running-average background mode (toggle vs consecutive-frame diff), for slow or hovering passes.
- ROI exclusion mask (paint out lamps/fans).
- Auto-calibrate `pixelDiffThreshold` too.
- Move processing to OffscreenCanvas + Worker if the UI lags.

**Product:**
- Lap timer UI: current / last / best lap, session list.
- Spoken lap times (`speechSynthesis`).
- Two-line direction detection (A then B = valid lap).
- Sub-frame timing (interpolate crossing between two frames).
- Session history (IndexedDB), lap export.
- Drag/pinch ROI editing on touch.

## 6. PWA notes (future)
- **HTTPS required** for the camera. Dev on a phone: `vite --host` + `@vitejs/plugin-basic-ssl` (or mkcert).
- **Which camera:** phone face-up → front camera sees the ceiling and the screen stays visible (lower quality, easy setup). Rear camera → needs a stand, screen not visible. Support `facingMode` + `deviceId`.
- Screen Wake Lock API (stop the screen sleeping); watch battery/heat in long sessions.
- Screen lock / app switch stops the camera → pause/resume the session (`resetGapMs` already covers the detector side).
- iOS: camera works in an installed PWA on recent iOS but has been buggy, so **test early**. `requestVideoFrameCallback` is supported since Safari 15.4. Audio needs a user tap to unlock.
- Manual exposure/focus (`applyConstraints` `exposureMode`, `focusMode`) is mostly Android Chrome only. Nice to have there, not something to rely on.
- Manifest + service worker for offline use; everything stays on the device.

## 7. Open questions
- Phone face-up (front camera) vs rear camera on a stand: decide after the first floor test.
- Lap timestamp: `Δstart` vs `Δpeak`. Decide from Phase 3 data.
- Track layout guideline: the camera spot must be crossed **once per lap** (no overlapping track sections above it).
- Is 60 fps available on target phones in the browser, and does it measurably help?
