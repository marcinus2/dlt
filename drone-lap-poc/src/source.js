// Camera access lives only here. Frames are delivered once per camera frame via rVFC.

export async function listCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'videoinput').map((d) => ({ deviceId: d.deviceId, label: d.label }));
}

// createSource(video, config) -> { startCamera, stopCamera, onFrame, settings }
// onFrame(cb): cb({ t, mediaTime, dropped, gapReset, tSource })
export function createSource(video, config) {
  let stream = null;
  let cb = null;
  let handle = null;
  let lastT = null, lastPresented = null, lastTime = -1;

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

  function stopCamera() {
    if (stream) stream.getTracks().forEach((tr) => tr.stop());
    stream = null;
    video.srcObject = null;
  }

  const settings = () => (stream ? stream.getVideoTracks()[0].getSettings() : null);

  function emit(now, meta) {
    const hasMeta = !!meta;
    const t = hasMeta && meta.captureTime != null ? meta.captureTime : now;
    let dropped = 0;
    if (hasMeta && meta.presentedFrames != null) {
      if (lastPresented !== null) dropped = Math.max(0, meta.presentedFrames - lastPresented - 1);
      lastPresented = meta.presentedFrames;
    }
    const gapReset = lastT !== null && t - lastT > config.resetGapMs;
    lastT = t;
    cb({
      t, dropped, gapReset,
      mediaTime: hasMeta ? meta.mediaTime : video.currentTime,
      tSource: hasMeta && meta.captureTime != null ? 'captureTime' : 'now',
    });
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

  return { startCamera, stopCamera, onFrame, settings };
}
