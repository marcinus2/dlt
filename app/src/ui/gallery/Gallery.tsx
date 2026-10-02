import { buildLabel } from '../build-info.ts';
import { PRESETS } from './presets.ts';

/** `?gallery`: every preset as a link for device review (plan 2.11). */
export function Gallery() {
  const groups = [...new Set(PRESETS.map((p) => p.group))];
  return (
    <main className="mx-auto w-full max-w-[720px] px-safe pt-safe pb-safe-bar">
      <h1 className="pt-6 text-3xl font-extrabold">State gallery</h1>
      <p className="mt-2 text-text-muted">
        Every screen state, simulated. Settings changed here are never saved. {buildLabel}
      </p>
      <p className="mt-3">
        <a href="./" className="inline-flex min-h-12 items-center font-semibold text-accent underline">
          Open the app
        </a>
      </p>
      {groups.map((g) => (
        <section key={g} className="mt-6">
          <h2 className="text-lg font-bold text-text">{g}</h2>
          <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {PRESETS.filter((p) => p.group === g).map((p) => (
              <li key={p.id}>
                <a
                  href={`./?state=${p.id}`}
                  className="flex min-h-12 items-center rounded-card border border-border bg-surface px-4 font-semibold text-text hover:border-accent"
                >
                  {p.title}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
