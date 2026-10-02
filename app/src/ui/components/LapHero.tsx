import { m } from 'motion/react';
import { formatLap } from '../../session/laps.ts';
import type { SessionData } from '../../session/types.ts';
import { cx } from '../cx.ts';
import { T_LAP } from '../motion.tsx';
import { BestBadge } from './BestBadge.tsx';

function liveText(n: number, ms: number, best: boolean): string {
  const t = formatLap(ms);
  return `Lap ${n}, ${t}${ms < 59995 ? ' seconds' : ''}${best ? ', best lap' : ''}`;
}

/** Latest lap: the largest element on screen (spec §3.3, §4.2). Fixed height: no layout shift. */
export function LapHero({ session }: { session: SessionData }) {
  const { laps, bestIdx, timing } = session;
  const latest = laps.at(-1);
  const isBest = latest !== undefined && bestIdx === laps.length - 1;
  const best = bestIdx === null ? undefined : laps[bestIdx];
  const running = timing.kind === 'running';

  return (
    <section aria-label="Latest lap" className="@container relative">
      <p className="sr-only" aria-live="polite">
        {latest ? liveText(latest.n, latest.ms, isBest) : ''}
      </p>
      <div
        aria-hidden
        className="flex h-8 items-center gap-3 text-lg font-extrabold tracking-wider text-text uppercase short:h-7"
      >
        {latest ? `Lap ${latest.n}` : 'Lap 1'}
        {isBest && <BestBadge />}
      </div>
      <div aria-hidden className="relative">
        {isBest && (
          <m.span
            key={`pulse-${latest.n}`}
            className="pointer-events-none absolute inset-y-[10%] -left-4 right-1/4 rounded-full shadow-glow-best"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0] }}
            transition={{ duration: 0.6 }}
          />
        )}
        <m.div
          key={latest?.n ?? 0}
          initial={latest ? { y: 12, opacity: 0 } : false}
          animate={{ y: 0, opacity: 1 }}
          transition={T_LAP}
          data-testid="lap-hero"
          className={cx(
            'relative font-mono text-lap-hero font-extrabold whitespace-nowrap short:text-[clamp(3rem,min(24cqi,20dvh),8rem)]',
            isBest ? 'text-best' : latest ? 'text-text' : 'text-text-muted',
          )}
        >
          {latest ? formatLap(latest.ms) : '--.--'}
        </m.div>
      </div>
      <p
        className="mt-2 flex h-8 items-center text-xl font-semibold text-text short:mt-1 short:h-7"
        data-testid="lap-summary"
      >
        {laps.length > 0 ? (
          <>
            Laps {laps.length}
            <span aria-hidden className="mx-2 text-text-muted">
              ·
            </span>
            Best <span className="ml-1.5 font-mono text-best">{best ? formatLap(best.ms) : '--.--'}</span>
          </>
        ) : running ? (
          'Lap 1 running'
        ) : (
          'Waiting for first pass'
        )}
      </p>
    </section>
  );
}
