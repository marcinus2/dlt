// Real PoC `dronelap.settings.v1` payloads for the migration tests.
/** What the PoC (`drone-lap-poc/src/config.js`) saves: JSON.stringify(config), edited by the user. */
export const POC_PAYLOAD = {
  cameraWidth: 320,
  cameraHeight: 640,
  exposureManual: false,
  exposureTime: 50,
  focusLock: true,
  cameraFps: 60,
  fpsExact: true,
  processingMaxSize: 160,
  pixelDiffThreshold: 14,
  brightnessNormalize: true,
  globalGuardRatio: 0.3,
  globalGuard: true,
  showDisplay: false,
  readbackHint: false,
  startRatio: 0.035,
  endRatio: 0.012,
  minMotionMs: 40,
  endHoldMs: 80,
  cooldownMs: 2500,
  maxMotionMs: 2000,
  warmupMs: 1000,
  resetGapMs: 300,
  calibrationMs: 4000,
  calibrationK: 6,
  roi: { x: 0.425, y: 0.1, width: 0.15, height: 0.8 },
};

/** An early PoC build: frame-count filter, display flag, partial roi. */
export const OLD_POC_PAYLOAD = {
  minMotionFrames: 2,
  showDisplay: true,
  startRatio: 0.05,
  endRatio: 0.02,
  cooldownMs: 2000,
  roi: { x: 0.2, y: 0.25 },
};
