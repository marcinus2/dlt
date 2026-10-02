import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { type AppStoreApi, createAppStore, type StoreOptions } from './app/store.ts';
import { createSettingsStorage, memoryBackend } from './settings/storage.ts';
import { App } from './ui/App.tsx';
import { StoreProvider } from './ui/store.tsx';
import './styles/index.css';

// URL flags, read once (spec §2: no routing). Sim is the default until M5 (G11).
const params = new URLSearchParams(location.search);
const debug = params.get('debug') === '1';
const lap = Number(params.get('lap'));
const presetId = params.get('state');

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');
const reactRoot = createRoot(root);

async function boot(): Promise<AppStoreApi> {
  const gallery = presetId !== null; // G12: sim-backed, placeholder camera, never touches saved settings
  const [{ createSim }, presets] = await Promise.all([
    import('./sim/index.ts'),
    gallery ? import('./ui/gallery/presets.ts') : null,
  ]);
  const { effects, controls } = createSim({
    settings: createSettingsStorage(gallery ? memoryBackend() : undefined),
    realCamera: !gallery && params.get('cam') !== 'fake',
    lapMs: lap > 0 ? lap * 1000 : undefined,
    auto: !gallery && params.get('auto') !== '0',
    log: debug ? (msg) => console.info(`[sim] ${msg}`) : undefined,
  });
  const opts: StoreOptions = { effects, sim: controls, debug };
  const preset = presets?.findPreset(presetId);
  if (presets && preset)
    Object.assign(opts, { state: presets.presetState(preset), ui: preset.ui, draft: preset.draft });
  const store = createAppStore(opts);
  if (store.getState().state.camera === 'live') store.resumeLive();
  return store;
}

if (params.has('gallery')) {
  import('./ui/gallery/Gallery.tsx').then(({ Gallery }) => reactRoot.render(<Gallery />));
} else {
  boot().then((store) => {
    reactRoot.render(
      <StrictMode>
        <StoreProvider store={store}>
          <App />
        </StoreProvider>
      </StrictMode>,
    );
  });
}
