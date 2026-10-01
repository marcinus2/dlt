# Drone Lap Counter — PoC Prompt

## Goal
Build a minimal browser PoC (macOS, built-in webcam) that detects **when motion appears in a region of the image** using frame differencing.

Question to answer: *Is frame difference good enough to detect a small drone passing a static camera?*

Long-term use: a static phone times drone laps; each detected pass = a potential lap. **Not now.** No drone/object recognition — only "enough change occurred in the ROI".

## Stack & Constraints
- **Use:** HTML, CSS, vanilla JS, `getUserMedia()`, `<video>`, `<canvas>`. Minimal Vite project preferred (no framework); a plain local server is acceptable.
- **Do not use/implement:** backend, PWA, React, TypeScript, DB, auth, ML/AI, object detection, OpenCV(.js), MediaPipe, cloud, deployment, full race logic.
- Keep code simple and easy to extend.

```
drone-lap-poc/
├── index.html
├── style.css
├── app.js
├── package.json
└── README.md
```

## Algorithm
Per frame (via `requestAnimationFrame`):
1. Draw `<video>` to a small canvas (~320×240).
2. Compare ROI pixels with the previous frame (grayscale allowed; or `|Δr|+|Δg|+|Δb|`).
3. Pixel is "changed" if diff > `pixelDiffThreshold`.
4. `motionRatio = changedPixels / totalROIPixels`.
5. Motion = `motionRatio > motionPixelRatioThreshold`.

Avoid needless large-array copies (reuse buffers).

### State machine
`NO_MOTION → MOTION → NO_MOTION`
- Emit one `MOTION START` and one `MOTION END` per pass, never per frame.
- Motion must persist ≥ `minMotionDurationMs` to count.
- `cooldownMs` blocks repeated detections of the same pass.
- Timestamp with `performance.now()`; structure code so `lapTime = currentStart - previousStart` can be added later (log only for now).

## Config (single object, tunable at runtime)
```js
const config = {
  pixelDiffThreshold: 30,          // min per-pixel change
  motionPixelRatioThreshold: 0.02, // min fraction of ROI changed
  minMotionDurationMs: 50,         // min motion persistence
  cooldownMs: 500                  // min gap between detections
};
const roi = { x: 0.2, y: 0.25, width: 0.6, height: 0.5 }; // relative 0–1
```

## UI
- Camera view with ROI overlay + **second canvas** showing only pixels exceeding `pixelDiffThreshold` (debug diff view — essential).
- Buttons: `Start Camera`, `Start Detection`, `Stop Detection`.
- Live: status (`NO_MOTION`/`MOTION`), changed-pixel %, active threshold %.
- Inputs for pixel threshold, motion ratio threshold, cooldown (ideally also min duration and ROI).
- Event log, e.g. `13:42:10.231  MOTION START`.

## Known Risks (propose minimal fixes only if needed)
Camera noise, auto-exposure, lighting changes, whole-frame shifts, object too small/fast, motion blur, dropped frames, false positives.
Optional additions *only if justified:* grayscale, light blur, min blob size, temporal smoothing.

## Workflow
Deliver a minimal working version first, then analyze the risks above. Don't over-engineer; no complex CV pipeline.

## Deliverables
1. Complete project code.
2. macOS run instructions.
3. How to grant browser camera access.
4. Short explanation of the algorithm.
5. List of tunable parameters.
6. Simple test scenario.
7. Metrics to observe (e.g. idle-noise ratio, peak ratio during a pass, detections per pass, missed passes, false starts, event duration, FPS).

## Success Criteria
Camera on static background → detection started → object/drone passes → `MOTION START` then `MOTION END` → one pass = one detection → static scene yields no continuous motion → parameters tune easily.