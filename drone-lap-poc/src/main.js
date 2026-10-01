import { config, roiPresets } from './config.js';
import { createDetector } from './detector.js';
import { calibrate } from './calibration.js';
import { createBeeper } from './beep.js';
import { createGraph } from './graph.js';
import { createRecorder } from './recorder.js';
import { loadSettings, saveSettings, clearSettings } from './storage.js';
import { createMotion } from './motion.js';
import { createSource, listCameras } from './source.js';
import { registerServiceWorker } from './pwa.js';

const defaults = structuredClone(config);
loadSettings(config);
const persist = () => saveSettings(config);

const $ = (id) => document.getElementById(id);
const video = $('video'), preview = $('preview'), pctx = preview.getContext('2d');
const source = createSource(video, config);
const motion = createMotion(config, { globalGuard: true });
const detector = createDetector(config);
const recorder = createRecorder();
const beeper = createBeeper();
const graph = createGraph($('graph'), config);
$('diff').append(motion.diffCanvas);

let detecting = false;
let last = { ratio: 0, globalRatio: 0, global: false };
let flagged = false;
let calib = null;                              // { samples: [], endT } while calibrating                           // global guard tripped (not just a missing previous frame)
let passes = 0, lastPass = null, dropped = 0, tSource = '-';
let fpsCount = 0, fpsStart = performance.now(), fps = 0;

// --- camera ---
async function fillCameras() {
  const select = $('camera'), current = select.value;
  select.replaceChildren(...(await listCameras()).map((c, i) => new Option(c.label || `Camera ${i + 1}`, c.deviceId)));
  if (current) select.value = current;
}

$('startCamera').onclick = async () => {
  $('message').textContent = '';
  try {
    await source.startCamera($('camera').value || undefined);
    await fillCameras();                       // labels are empty until permission is granted
    const s = source.settings();
    $('message').textContent = '';
    $('startDetection').disabled = $('calibrate').disabled = false;
    log('camera', `CAMERA         ${s.width}x${s.height} @ ${s.frameRate} fps`);
    source.onFrame(onFrame);
  } catch (err) {
    $('message').textContent = `Camera error: ${err.message}`;
  }
};

$('videoFile').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  $('message').textContent = '';
  try {
    const s = await source.startFile(file);
    $('startDetection').disabled = $('calibrate').disabled = false;
    setDetecting(false);
    log('camera', `FILE           ${file.name} ${s.width}x${s.height}`);
    source.onFrame(onFrame);
  } catch (err) {
    $('message').textContent = `File error: ${err.message}`;
  }
};

// --- detection ---
$('startDetection').onclick = () => setDetecting(true);
$('stopDetection').onclick = () => setDetecting(false);

function setDetecting(on) {
  if (on && calib) { calib = null; $('calibrate').disabled = false; $('message').textContent = ''; }
  detecting = on;
  $('startDetection').disabled = on;
  $('stopDetection').disabled = !on;
  if (on) {
    motion.reset();
    detector.reset();                          // warm-up starts at the first sample
    passes = 0; lastPass = null; dropped = 0; flagged = false;
    recorder.clear();
  }
}

function onFrame(frame) {
  drawPreview();
  if (!detecting && !calib) return;
  if (frame.gapReset) motion.reset();
  if (frame.seeked) detector.reset(frame.t);   // file loop / seek
  const m = motion.process(video, config.roi);
  last = m;
  const nowFlagged = m.globalRatio > config.globalGuardRatio;
  if (nowFlagged && !flagged) log('global', `GLOBAL CHANGE  outside ROI ${(m.globalRatio * 100).toFixed(1)}%, frames ignored`);
  flagged = nowFlagged;
  dropped += frame.dropped;
  tSource = frame.tSource;
  fpsCount++;
  if (calib) { graph.push(m.ratio, m.global, false); recorder.addFrame(frame.t, m.ratio, m.globalRatio, m.global, 'CALIB'); collectCalibration(m, frame.t); return; }
  const events = detector.update({ t: frame.t, ratio: m.ratio, global: m.global, gapReset: frame.gapReset });
  for (const e of events) { recorder.addEvent(e); onEvent(e); }
  recorder.addFrame(frame.t, m.ratio, m.globalRatio, m.global, detector.state);
  graph.push(m.ratio, m.global, detector.state === 'MOTION');
}

// --- calibration: sample the idle scene, then set start/end thresholds ---
$('calibrate').onclick = () => {
  setDetecting(false);
  motion.reset();
  calib = { samples: [], endT: null };
  $('calibrate').disabled = true;
  $('message').textContent = 'Calibrating: keep the scene static…';
};

function collectCalibration(m, t) {
  if (calib.endT === null) calib.endT = t + config.calibrationMs;
  if (!m.global) calib.samples.push(m.ratio);      // global frames are excluded
  if (t < calib.endT) return;
  const c = calibrate(calib.samples, config.calibrationK);
  calib = null;
  $('calibrate').disabled = false;
  if (!c) { $('message').textContent = 'Calibration failed: no usable frames'; return; }
  $('message').textContent = '';
  config.startRatio = c.startRatio;
  config.endRatio = c.endRatio;
  syncInputs();
  persist();
  const pct = (v) => `${(v * 100).toFixed(3)}%`;
  log('calib', `CALIBRATION    n ${c.n}  mean ${pct(c.mean)}  σ ${pct(c.sigma)}  max ${pct(c.max)}  -> start ${pct(c.startRatio)}  end ${pct(c.endRatio)}`);
  if (c.hint) log('rejected', `CALIBRATION    ${c.hint}`);
}

function onEvent(e) {
  const s = (ms) => (ms === null ? '-' : `${(ms / 1000).toFixed(3)} s`);
  switch (e.type) {
    case 'MOTION_START':
      beeper.beep();
      log('start', `MOTION START   Δstart ${s(e.dStart)}`);
      break;
    case 'MOTION_END':
      passes++;
      lastPass = e;
      log('end', `MOTION END     dur ${Math.round(e.durationMs)} ms  peak ${(e.peakRatio * 100).toFixed(1)}%  frames ${e.frames}  Δpeak ${s(e.dPeak)}`);
      break;
    case 'SUPPRESSED':
      log('suppressed', `SUPPRESSED     (${e.reason})`);
      break;
    case 'REJECTED':
      log('rejected', `REJECTED       long motion ${(e.durationMs / 1000).toFixed(1)} s`);
      break;
  }
}

// --- preview with ROI overlay (outside area dimmed) ---
function drawPreview() {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw) return;
  const h = Math.round((preview.width * vh) / vw);
  if (preview.height !== h) preview.height = h;
  const W = preview.width, H = preview.height;
  pctx.drawImage(video, 0, 0, W, H);
  const { x, y, width, height } = config.roi;
  const rx = x * W, ry = y * H, rw = width * W, rh = height * H;
  pctx.fillStyle = 'rgba(0,0,0,0.55)';
  pctx.fillRect(0, 0, W, ry);
  pctx.fillRect(0, ry + rh, W, H - ry - rh);
  pctx.fillRect(0, ry, rx, rh);
  pctx.fillRect(rx + rw, ry, W - rx - rw, rh);
  pctx.strokeStyle = last.global && detecting ? '#f66' : '#6f6';
  pctx.strokeRect(rx, ry, rw, rh);
}

// --- stats (text only, ~4 Hz) ---
setInterval(() => {
  const now = performance.now();
  fps = (fpsCount * 1000) / (now - fpsStart);
  fpsCount = 0; fpsStart = now;
  const pct = (v) => `${(v * 100).toFixed(2)}%`;
  const cam = source.settings();
  $('stats').textContent = [
    `state     ${detecting ? detector.state : 'OFF'}`,
    `ratio     ${pct(last.ratio)}   global ${pct(last.globalRatio)}${last.global ? ' (flagged)' : ''}`,
    `start/end ${pct(config.startRatio)} / ${pct(config.endRatio)}${calib ? '   (calibrating)' : ''}`,
    `fps       ${detecting ? fps.toFixed(1) : '-'}   dropped ${dropped}`,
    `camera    ${cam ? `${cam.width}x${cam.height} @ ${cam.frameRate}` : '-'}   t: ${tSource}`,
    `passes    ${passes}`,
    `last pass ${lastPass ? `${Math.round(lastPass.durationMs)} ms, peak ${pct(lastPass.peakRatio)}, ${lastPass.frames} frames` : '-'}`,
  ].join('\n');
}, 250);

// --- event log ---
const logEl = $('log');
function log(cls, text) {
  const d = new Date();
  const ts = d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  const line = document.createElement('div');
  line.className = cls;
  line.textContent = `${ts}  ${text}`;
  const pinned = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 4;
  logEl.append(line);
  if (logEl.childElementCount > 500) logEl.firstChild.remove();
  if (pinned) logEl.scrollTop = logEl.scrollHeight;
}
$('clearLog').onclick = () => logEl.replaceChildren();

// --- inputs generated from config, applied live ---
const inputs = [];                             // { obj, key, input }, for syncInputs()
function syncInputs() {
  for (const { obj, key, input } of inputs) {
    if (input.type === 'checkbox') input.checked = obj[key];
    else input.value = obj[key];
  }
}

function addInput(parent, obj, key, opts = {}) {
  const label = document.createElement('label');
  label.textContent = key;
  const input = document.createElement('input');
  if (typeof obj[key] === 'boolean') {
    input.type = 'checkbox';
    input.checked = obj[key];
    input.onchange = () => { obj[key] = input.checked; persist(); };
  } else {
    input.type = 'number';
    input.step = opts.step ?? 'any';
    if (opts.min !== undefined) input.min = opts.min;
    if (opts.max !== undefined) input.max = opts.max;
    input.value = obj[key];
    input.oninput = () => {
      const v = parseFloat(input.value);
      if (Number.isFinite(v)) { obj[key] = v; persist(); }
    };
  }
  label.append(input);
  parent.append(label);
  inputs.push({ obj, key, input });
}

for (const key of Object.keys(config)) {
  if (typeof config[key] !== 'object') addInput($('configInputs'), config, key);
}
for (const key of ['x', 'y', 'width', 'height']) {
  addInput($('roiInputs'), config.roi, key, { step: 0.01, min: 0, max: 1 });
}

// --- CSV export ---
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
$('exportEvents').onclick = () => download('events', recorder.eventsCsv());
$('exportFrames').onclick = () => download('frames', recorder.framesCsv());

// --- beep ---
document.addEventListener('click', () => beeper.unlock());   // AudioContext needs a user gesture
$('mute').onchange = (e) => { beeper.muted = e.target.checked; };

// --- ROI presets ---
$('roiPreset').replaceChildren(...Object.keys(roiPresets).map((k) => new Option(k, k)), new Option('custom', 'custom'));
$('roiPreset').onchange = (e) => {
  if (!roiPresets[e.target.value]) return;
  Object.assign(config.roi, roiPresets[e.target.value]);
  syncInputs();
  persist();
};
$('resetDefaults').onclick = () => {
  const { roi, ...rest } = structuredClone(defaults);
  Object.assign(config, rest);
  Object.assign(config.roi, roi);      // in place: the ROI inputs hold this object
  clearSettings();
  syncInputs();
  syncPresetSelect();
};
function syncPresetSelect() {
  const name = Object.keys(roiPresets).find((k) => Object.keys(config.roi).every((p) => config.roi[p] === roiPresets[k][p]));
  $('roiPreset').value = name ?? 'custom';
}
syncPresetSelect();
$('roiInputs').oninput = () => { $('roiPreset').value = 'custom'; };

fillCameras().catch(() => {});
registerServiceWorker();
