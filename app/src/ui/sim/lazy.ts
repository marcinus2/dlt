import { lazy } from 'react';

/** SIMULATED strip under the top menu; a lazy chunk outside the initial budget (G11). */
export const SimBar = lazy(() => import('./SimPanel.tsx'));
