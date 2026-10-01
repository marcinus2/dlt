export const roiPresets = {           // relative 0–1
  full:  { x: 0,     y: 0,     width: 1,    height: 1    },
  box:   { x: 0.2,   y: 0.25,  width: 0.6,  height: 0.5  },
  vLine: { x: 0.425, y: 0.1,   width: 0.15, height: 0.8  }, // virtual finish line
  hLine: { x: 0.1,   y: 0.425, width: 0.8,  height: 0.15 },
};

export const config = {
  // camera (applied on Start Camera)
  cameraWidth: 240,            // requested; readback cost scales with frame size
  cameraHeight: 480,
  exposureManual: true,        // lock exposure (Android Chrome); a short time keeps the camera at full fps
  exposureTime: 100,           // units of 100 µs (50 = 5 ms ≈ 1/200 s), clamped to the camera's range
  focusLock: false,            // freeze autofocus at its current distance (Android Chrome)
  cameraFps: 30,               // requested frame rate (applied on Start Camera)
  fpsExact: false,             // true = fail instead of falling back when the camera can't do cameraFps
  // motion
  processingMaxSize: 320,      // longest side of the processed ROI (px)
  pixelDiffThreshold: 10,      // min luma change per pixel
  brightnessNormalize: false,  // cancel global brightness shift
  globalGuardRatio: 0.2,       // outside-ROI change fraction that flags a frame as global
  globalGuard: false,          // full-frame guard; costs a second video readback per frame
  showDisplay: true,           // preview, diff view and graph; off = less CPU
  readbackHint: true,          // willReadFrequently canvases (CPU); off = GPU canvas, may be faster on Android
  // detector
  startRatio: 0.02,            // ROI fraction to start motion
  endRatio: 0.01,              // ROI fraction below which motion may end (hysteresis)
  minMotionMs: 30,             // motion must last this long (first to latest frame) to confirm a start; 0 = one frame
  endHoldMs: 60,               // quiet for this long (first to latest quiet frame) to confirm an end
  cooldownMs: 1500,            // min gap between accepted STARTs
  maxMotionMs: 3000,           // longer motion = rejected (not a drone pass)
  warmupMs: 1500,              // ignore after start (auto-exposure settling)
  resetGapMs: 250,             // frame gap that resets the previous frame
  // calibration
  calibrationMs: 3000,
  calibrationK: 5,
  // region of interest, relative 0–1
  roi: { ...roiPresets.full },
};
