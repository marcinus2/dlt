import { createContext, type ReactNode, useContext } from 'react';
import { useStore } from 'zustand';
import type { AppStore, AppStoreApi } from '../app/store.ts';

const StoreContext = createContext<AppStoreApi | null>(null);

export function StoreProvider({ store, children }: { store: AppStoreApi; children: ReactNode }) {
  return <StoreContext value={store}>{children}</StoreContext>;
}

export function useStoreApi(): AppStoreApi {
  const api = useContext(StoreContext);
  if (!api) throw new Error('StoreProvider missing');
  return api;
}

/** Subscribe to a slice; return primitives or stable references (or wrap with useShallow). */
export function useApp<T>(selector: (s: AppStore) => T): T {
  return useStore(useStoreApi(), selector);
}

export const useDispatch = () => useApp((s) => s.dispatch);
