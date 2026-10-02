// Debug HUD for the app screens (`?debug=1`): speech latency probe (plan 6.6), MOTION_END frame
// time → utterance start, p90 over the last 20 passes. Updates at pass rate, never per frame.
import { LATENCY_WINDOW } from '../../app/effects.ts';
import { useApp } from '../store.tsx';

export function SpeechLatencyHud() {
  const l = useApp((s) => s.ui.speechLatency);
  return (
    <p className="font-mono text-sm text-text-muted" data-testid="speech-latency">
      speech p90 {l ? `${Math.round(l.p90)} ms` : '-'} · last {l ? `${Math.round(l.last)} ms` : '-'} ·{' '}
      {l?.n ?? 0}/{LATENCY_WINDOW}
    </p>
  );
}
