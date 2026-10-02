import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRealEffects } from './app/real.ts';
import { type AppStoreApi, createAppStore, type StoreOptions } from './app/store.ts';
import { createAnnouncer } from './audio/announcer.ts';
import { createSettingsStorage, memoryBackend } from './settings/storage.ts';
import { App } from './ui/App.tsx';
import { StoreProvider } from './ui/store.tsx';
import './styles/index.css';

// URL flags, read once (spec §2: no routing). Real engine by default; sim is opt-in (`?sim=1`, G11).
const params = new URLSearchParams(location.search);
const debug = params.get('debug') === '1';
const sim = params.get('sim') === '1';
const lap = Number(params.get('lap'));
const presetId = params.get('state');

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');
const reactRoot = createRoot(root);

async function boot(): Promise<AppStoreApi> {
  const gallery = presetId !== null; // G12: sim-backed, placeholder camera, never touches saved settings
  if (!sim && !gallery) {
    const effects = createRealEffects({
      settings: createSettingsStorage(),
      log: debug ? (msg) => console.info(`[fx] ${msg}`) : undefined,
    });
    return createAppStore({ effects, debug });
  }
  const [{ createSim }, presets] = await Promise.all([
    import('./sim/index.ts'),
    gallery ? import('./ui/gallery/presets.ts') : null,
  ]);
  // Sim-only flags: `?cam=fake` placeholder camera, `?auto=0`, `?lap=<s>`.
  const { effects, controls } = createSim({
    settings: createSettingsStorage(gallery ? memoryBackend() : undefined),
    audio: createAnnouncer(),
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

if (params.get('debug') === 'engine') {
  // Engine debug page (plan 4.10): real camera / file → engine, saved settings. Lazy chunk.
  Promise.all([import('./app/debug-rig.ts'), import('./ui/debug/DebugPage.tsx')]).then(
    ([{ createDebugRig }, { DebugPage }]) => {
      const rig = createDebugRig(createSettingsStorage().load());
      reactRoot.render(<DebugPage rig={rig} />);
    },
  );
} else if (params.has('gallery')) {
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
