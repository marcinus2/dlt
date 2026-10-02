import { BuildFooter } from '../components/BuildFooter.tsx';

/** Placeholder until M2: checks fonts, colours and safe areas on devices. */
export function Welcome() {
  return (
    <div className="mx-auto flex min-h-screen-d w-full max-w-[480px] flex-col">
      <header className="px-safe pt-safe">
        <h1 className="py-4 text-center text-lg font-semibold tracking-wide">Drone Lap Counter</h1>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-8 px-safe">
        <button
          type="button"
          disabled
          className="aspect-square w-[min(72vw,320px)] min-w-[200px] rounded-full bg-accent text-button font-extrabold uppercase text-accent-ink shadow-glow-accent disabled:opacity-90"
        >
          Get ready
        </button>
        <p className="font-mono text-lap-row font-semibold">
          12.34 <span className="text-best">★ 11.98</span>
        </p>
        <p className="text-center text-text-muted">Shell preview — screens arrive in M2.</p>
      </main>

      <BuildFooter />
    </div>
  );
}
