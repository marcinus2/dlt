import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { type AppStoreApi, createAppStore } from './app/store.ts';
import { createSettingsStorage } from './settings/storage.ts';
import { App } from './ui/App.tsx';
import { StoreProvider } from './ui/store.tsx';
import './styles/index.css';

// URL flags, read once (spec §2: no routing). Sim is the default until M5 (G11).
const params = new URLSearchParams(location.search);
const debug = params.get('debug') === '1';
const lap = Number(params.get('lap'));

async function boot(): Promise<AppStoreApi> {
  const { createSim } = await import('./sim/index.ts');
  const { effects, controls } = createSim({
    settings: createSettingsStorage(),
    realCamera: params.get('cam') !== 'fake',
    lapMs: lap > 0 ? lap * 1000 : undefined,
    auto: params.get('auto') !== '0',
    log: debug ? (msg) => console.info(`[sim] ${msg}`) : undefined,
  });
  return createAppStore({ effects, sim: controls, debug });
}

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');

boot().then((store) => {
  createRoot(root).render(
    <StrictMode>
      <StoreProvider store={store}>
        <App />
      </StoreProvider>
    </StrictMode>,
  );
});
