import { Download, Share } from 'lucide-react';
import { Banner } from '../components/Banner.tsx';
import { BigButton } from '../components/BigButton.tsx';
import { BuildFooter } from '../components/BuildFooter.tsx';
import { TopBar } from '../components/TopBar.tsx';
import { useApp } from '../store.tsx';
import { UpdateToast } from './UpdateToast.tsx';

/** Welcome (spec §3.1): top menu · GET READY! · footer with install link / iOS hint / update toast. */
export function Welcome() {
  const dispatch = useApp((s) => s.dispatch);
  const install = useApp((s) => s.ui.install);
  const setUi = useApp((s) => s.setUi);
  const showToast = useApp((s) => s.showToast);

  return (
    <>
      <TopBar />
      <main className="mx-auto flex w-full max-w-[480px] flex-1 flex-col items-center justify-center gap-8 px-safe py-8">
        <h1 className="text-center text-sm font-bold tracking-[0.2em] text-text-muted uppercase">
          Drone Lap Counter
        </h1>
        <BigButton label="Get ready!" tone="accent" onPress={() => dispatch({ type: 'GET_READY' })} />
      </main>
      <footer className="mx-auto flex w-full max-w-[480px] flex-col gap-3 px-safe">
        {install === 'iosHint' && (
          <Banner
            tone="info"
            icon={Share}
            title="Install on iPhone"
            onDismiss={() => setUi({ install: 'none' })}
          >
            Tap Share, then Add to Home Screen.
          </Banner>
        )}
        <UpdateToast />
      </footer>
      <BuildFooter>
        {install === 'prompt' && (
          <button
            type="button"
            // M9 wires beforeinstallprompt; the prototype only shows where the link lives.
            onClick={() => showToast('Install arrives with offline support (M9)')}
            className="inline-flex min-h-12 items-center gap-1.5 font-semibold text-accent"
          >
            <Download aria-hidden size={18} />
            Install app
          </button>
        )}
      </BuildFooter>
    </>
  );
}
