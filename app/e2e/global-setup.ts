// Generates the fake-camera clip (plan 5.4) before any Chromium test starts.
import { ensureY4m } from './tools/make-y4m.ts';

export default function globalSetup() {
  ensureY4m();
}
