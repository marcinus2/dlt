// Camera access lives only here. Frames are delivered once per camera frame via rVFC.

export async function listCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'videoinput').map((d) => ({ deviceId: d.deviceId, label: d.label }));
}

// createSource(video, config) -> { startCamera, startFile, stopCamera, onFrame, settings }
// onFrame(cb): cb({ t, mediaTime, dropped, gapReset, seeked, tSource })
// Files use mediaTime * 1000 as t (not wall clock) and loop; a seek/loop sets seeked + gapReset.
export function createSource(video, config) {
  let stream = null, objectUrl = null, isFile = false;
  let cb = null;
  let handle = null;
  let lastT = null, lastPresented = null, lastTime = -1;

  function clearFile() {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    isFile = false;
    video.loop = false;
    video.removeAttribute('src');
  }

  async function startCamera(deviceId) {
    stopCamera();
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 },
      },
    });
    video.srcObject = stream;
    await video.play();
    lastT = lastPresented = null;
    return settings();
  }

  async function startFile(file) {
    stopCamera();
    objectUrl = URL.createObjectURL(file);
    isFile = true;
    video.loop = true;
    video.src = objectUrl;
    await video.play();
    lastT = lastPresented = null;
    lastTime = -1;
    return settings();
  }

  function stopCamera() {
    if (stream) stream.getTracks().forEach((tr) => tr.stop());
    stream = null;
    video.srcObject = null;
    clearFile();
  }

  function settings() {
    if (stream) return stream.getVideoTracks()[0].getSettings();
    return isFile ? { width: video.videoWidth, height: video.videoHeight, frameRate: 'file' } : null;
  }

  function emit(now, meta) {
    const hasMeta = !!meta;
    const mediaTime = hasMeta ? meta.mediaTime : video.currentTime;
    const useCapture = !isFile && hasMeta && meta.captureTime != null;
    const t = isFile ? mediaTime * 1000 : useCapture ? meta.captureTime : now;
    const seeked = lastT !== null && t < lastT;
    let dropped = 0;
    if (hasMeta && meta.presentedFrames != null) {
      if (lastPresented !== null && !seeked) dropped = Math.max(0, meta.presentedFrames - lastPresented - 1);
      lastPresented = meta.presentedFrames;
    }
    const gapReset = seeked || (lastT !== null && t - lastT > config.resetGapMs);
    lastT = t;
    cb({ t, mediaTime, dropped, gapReset, seeked, tSource: isFile ? 'mediaTime' : useCapture ? 'captureTime' : 'now' });
  }

  function loopRvfc(now, meta) {
    if (!cb) return;
    emit(now, meta);
    handle = video.requestVideoFrameCallback(loopRvfc);
  }

  function loopRaf(now) {
    if (!cb) return;
    if (video.currentTime !== lastTime && video.readyState >= 2) {   // same frame again -> skip
      lastTime = video.currentTime;
      emit(now, null);
    }
    handle = requestAnimationFrame(loopRaf);
  }

  // One callback at a time. Returns an unsubscribe function.
  function onFrame(fn) {
    cb = fn;
    if (handle !== null) return stop;
    handle = 'requestVideoFrameCallback' in video
      ? video.requestVideoFrameCallback(loopRvfc)
      : requestAnimationFrame(loopRaf);
    return stop;
  }

  function stop() {
    if (cb && handle !== null) {
      if ('requestVideoFrameCallback' in video) video.cancelVideoFrameCallback(handle);
      else cancelAnimationFrame(handle);
    }
    cb = null;
    handle = null;
  }

  return { startCamera, startFile, stopCamera, onFrame, settings };
}
