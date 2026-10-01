export const roiPresets = {           // relative 0–1
  box:   { x: 0.2,   y: 0.25,  width: 0.6,  height: 0.5  },
  vLine: { x: 0.425, y: 0.1,   width: 0.15, height: 0.8  }, // virtual finish line
  hLine: { x: 0.1,   y: 0.425, width: 0.8,  height: 0.15 },
};

export const config = {
  // camera (applied on Start Camera)
  cameraWidth: 640,            // requested; readback cost scales with frame size
  cameraHeight: 360,
  exposureManual: false,       // lock exposure (Android Chrome); a short time keeps the camera at full fps
  exposureTime: 50,            // units of 100 µs (50 = 5 ms ≈ 1/200 s), clamped to the camera's range
  // motion
  processingMaxSize: 320,      // longest side of the processed ROI (px)
  pixelDiffThreshold: 25,      // min luma change per pixel
  brightnessNormalize: true,   // cancel global brightness shift
  globalGuardRatio: 0.2,       // outside-ROI change fraction that flags a frame as global
  globalGuard: true,           // full-frame guard; costs a second video readback per frame
  showDisplay: true,           // preview, diff view and graph; off = less CPU
  readbackHint: true,          // willReadFrequently canvases (CPU); off = GPU canvas, may be faster on Android
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
  // region of interest, relative 0–1
  roi: { ...roiPresets.box },
};
