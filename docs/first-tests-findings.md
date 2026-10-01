# First phone tests — findings and decisions

> 2026-10-01/02. Devices: two Samsung Android phones (Chrome) and one iPhone. Numbers are read off the on-screen HUD by hand and rounded. The ceiling/whoop scenarios (dev-plan Phase 3) are **not** done yet; this covers performance and detector timing only.

## Problem
Android: **6–16 fps** after *Start Detection* (preview alone looked like 30), `dropped` ≈ 200 per 30 s, missed passes. iPhone: 55–60 fps. For a frame-differencing counter, fps decides whether a fast drone is seen at all.

## What the measurements showed
| Test | Result | Conclusion |
|---|---|---|
| Preview only vs detection | ~30 → 6–16 | Our per-frame work is the cost, not the camera |
| `globalGuard` + `showDisplay` off | about +5 fps | Real but minor; guard costs a second full-frame readback |
| Camera 1280×720 → 640×360 → 480×270 | <20 (~16) → 20–24 | Readback cost shrinks with frame size, but not proportionally: a fixed per-frame stall remains |
| `readbackHint` off (GPU canvas) | a bit better, unstable (16 / 20 / 27) | Not the fix; later "on" worked better together with manual exposure |
| fps dropped to 14–16 when moving the phone | — | Not our code (fixed cost per frame). Camera auto-exposure/AF re-metering lowers the camera's own rate |
| **Manual exposure 100 + 240×480 @ 30** | **fps 27–30 ≈ delivered 28–32** | **Main fix.** We now process nearly every camera frame |
| `ms/frame` at that setting | total 10–14 (mostly 12–13), preview 1.4, roi 6–14 | ~60% headroom at 30 fps; at 60 fps the 16.7 ms budget would be exceeded (roi spikes to 14 ms) |
| `focusLock` on/off | no visible fps difference | Kept as an option, off |
| `brightnessNormalize` on/off | no visible difference | Off (exposure is locked, so no drift to cancel) |

Root causes, in order of impact: (1) camera auto-exposure lowering/destabilising the frame rate on Samsung; (2) two synchronous canvas readbacks of the video per frame (ROI crop + full-frame guard), slow on Android Chrome; (3) frame size; (4) display work (small).

## Decisions and reasons
| Decision | Why |
|---|---|
| **Lock exposure by default** (`exposureManual: true`, `exposureTime: 100` = 10 ms) | Stops the camera dropping fps; also reduces motion blur. Logs `not supported` where unavailable (then the camera stays on auto). Needs a lower `pixelDiffThreshold` (darker image) |
| Camera 240×480, 30 fps (`fpsExact` off) | Smaller readback; the processed ROI is ≤320 px anyway. `exact` can make `getUserMedia` fail on phones that can't do it, so it's opt-in |
| `pixelDiffThreshold` 25 → **10** | Short exposure gives a darker image with smaller luma differences |
| `brightnessNormalize` → **off** | No measured effect with locked exposure |
| ROI default **full frame** (+ `full` preset) | Maximum chance to see a small/fast drone; no tuning of position |
| `globalGuard` default **off** | With a full-frame ROI nothing is outside it, so the guard can never trigger yet still costs a readback |
| `readbackHint` default **on** | Better fps together with manual exposure on the tested phones |
| `focusLock` default **off** | No fps benefit measured. Untested: whether AF hunting causes false motion |
| **Time-based detector debounce** (`minMotionMs` 30, `endHoldMs` 60) | Frame counts meant 33 ms vs 17 ms vs 50 ms at 30/60/20 fps, so tuned values didn't transfer between phones, and dropped frames stretched the end hold. Now measured on frame timestamps |
| **Rejected: OpenCV.js** | The diff is a trivial loop (<1 ms); the cost is getting pixels out of the video, which OpenCV can't speed up. Also ~8 MB WASM and breaks the no-dependency rule |
| **Deferred: `MediaStreamTrackProcessor` / WebGL readback** | Bigger changes outside the plan. Revisit only if ~30 fps proves insufficient |
| **Not pursued: 60 fps on Android** | Tested Samsungs deliver ~30 even with manual exposure; 12–13 ms/frame doesn't fit 16.7 ms anyway |

## Logic changes
- **Detector** ([detector.js](../drone-lap-poc/src/detector.js)): `minMotionFrames`/`endHoldFrames` → `minMotionMs`/`endHoldMs`. A pass confirms on the first non-neutral frame with `t − firstT ≥ minMotionMs` (`0` = one frame); it ends on the first non-neutral quiet frame with `t − firstQuietT ≥ endHoldMs`; re-arm after a rejected long motion uses the same quiet clock. Neutral (global/gap) frames still neither start nor extend either clock. 6 new tests (same pass at 10/20/30/60 fps, ms-not-frames, `minMotionMs: 0`, sparse frames, re-arm). Old saved values are ignored.
- **Motion** ([motion.js](../drone-lap-poc/src/motion.js)): guard, display and `willReadFrequently` read from config per frame (canvases recreated when `readbackHint` flips); display off skips the diff mask writes and `putImageData`; per-stage timing in a preallocated object (no per-frame allocation).
- **Source** ([source.js](../drone-lap-poc/src/source.js)): constraints from config; `applyExposure()` / `applyFocus()` via `applyConstraints` and a one-line report; frames also carry `presented`.
- **Main/graph:** applied live on config change (`syncControl`), HUD shows delivered fps and ms/frame; graph keeps recording while hidden.

## How to diagnose a new phone
1. Start the camera and detection; read `fps`, `delivered`, `dropped`, `ms/frame`.
2. `delivered` low or unstable → camera side: lock exposure (shorter time = higher rate), check the `EXPOSURE` log line, try `cameraFps`/`fpsExact`.
3. `delivered` fine but `fps` lower → ours: shrink the camera size, turn off `globalGuard`/`showDisplay`, compare `readbackHint`.

## Open items
- Missed passes: try `minMotionMs: 0` and count misses vs false starts (a pass shorter than one frame interval is invisible at any setting).
- Whether 240×480 is enough for a small drone at the real distance (full-frame ROI = ~115k px); watch SNR and misses.
- `exposureTime` is in units of 100 µs per the spec; confirm per device from the logged value and range, and pick a value for the real lighting.
- iPhone re-check with the new defaults (manual exposure may be unsupported or too dark there).
- Phase 3: ceiling/whoop scenarios, `Δstart` vs `Δpeak`, success criteria.
