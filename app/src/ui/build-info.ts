export const APP_VERSION = __APP_VERSION__;
export const GIT_SHA = __GIT_SHA__;

/** Shown in the footer so a device tester can tell which build they see. */
export const buildLabel = `v${APP_VERSION} · ${GIT_SHA}`;
