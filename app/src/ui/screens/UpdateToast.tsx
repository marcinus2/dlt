import { Toast } from '../components/Toast.tsx';
import { useApp } from '../store.tsx';

/** "New version — Reload", only on Welcome / Configuration (spec §2.5). Wired to the SW in M9. */
export function UpdateToast() {
  const available = useApp((s) => s.ui.updateAvailable);
  if (!available) return null;
  return (
    <Toast text="New version available" action={{ label: 'Reload', onClick: () => location.reload() }} />
  );
}
