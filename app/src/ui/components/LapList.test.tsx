import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { applyPass, newSession } from '../../session/laps.ts';
import type { SessionData } from '../../session/types.ts';
import { LapList } from './LapList.tsx';

/** Session from lap times in seconds. */
function session(...secs: number[]): SessionData {
  let s = applyPass(newSession(), 0).session;
  let t = 0;
  for (const sec of secs) {
    t += sec * 1000;
    s = applyPass(s, t).session;
  }
  return s;
}

const rows = () => within(screen.getByRole('list', { name: 'Lap history' })).getAllByRole('listitem');

describe('LapList', () => {
  it('lists every lap but the latest, newest first', () => {
    const s = session(14.02, 13.4, 11.98, 12.87, 12.34);
    render(<LapList laps={s.laps} bestIdx={s.bestIdx} />);
    expect(rows().map((r) => r.textContent)).toEqual(['#412.87', '#311.98Best', '#213.40', '#114.02']);
  });

  it('highlights the best row with a badge when the best is not the latest', () => {
    const s = session(14, 11.98, 13);
    render(<LapList laps={s.laps} bestIdx={s.bestIdx} />);
    const best = rows().filter((r) => r.dataset.best);
    expect(best).toHaveLength(1);
    expect(best[0]?.textContent).toContain('11.98');
    expect(within(best[0] as HTMLElement).getByText('Best')).toBeTruthy();
  });

  it('marks no row when the latest lap is the best (it is in the hero)', () => {
    const s = session(14, 13, 11);
    render(<LapList laps={s.laps} bestIdx={s.bestIdx} />);
    expect(rows().filter((r) => r.dataset.best)).toEqual([]);
  });

  it('renders nothing before the second lap', () => {
    const s = session(12);
    const { container } = render(<LapList laps={s.laps} bestIdx={s.bestIdx} />);
    expect(container.textContent).toBe('');
  });

  it('caps the list at the newest 500 rows plus "+N older laps"', () => {
    const s = session(...Array.from({ length: 600 }, (_, i) => 10 + (i % 7)));
    render(<LapList laps={s.laps} bestIdx={s.bestIdx} />);
    expect(rows()).toHaveLength(500);
    expect(rows()[0]?.textContent).toMatch(/^#599/);
    expect(rows()[499]?.textContent).toMatch(/^#100/);
    expect(screen.getByText('+99 older laps')).toBeTruthy();
  });
});
