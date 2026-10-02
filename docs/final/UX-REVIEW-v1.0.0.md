# UX review — v1.0.0 (M3)

> Build under review: Pages URL, footer shows version + git SHA — **write the SHA per round**. Screenshots of every state: [ux/](ux/) (`npm run screenshots` in `app/`, `phone-<id>.png` / `desktop-<id>.png`). Plan: [§5](PLAN-v1.0.0.md#5-m3--ux-review--freeze).
> Severity: **must** (blocks freeze) · **should** · **nice**. Add findings to the table at the bottom.

## Devices

| Device | Browser | Installed (home screen) | Reviewed | SHA |
|---|---|---|---|---|
| Android (reference Samsung) | Chrome | ☐ | ☐ | |
| iPhone | Safari | ☐ | ☐ | |
| macOS | Chrome / Safari | n/a | ☐ | |

## Checklist (per device)

- [ ] Portrait and landscape: no clipping, no horizontal scroll, START and STOP reachable
- [ ] Standalone: safe areas, status bar, notch / home indicator overlap nothing
- [ ] Latest lap readable at 3 m (hero digits), best lap clearly distinct
- [ ] Bright light / outdoors: contrast of neon accents and grey text
- [ ] Touch targets, one hand: START, STOP, CONTINUE / END, −/+ steppers; 300 ms tap guard (feels sluggish on START → STOP?)
- [ ] Motion: screen transitions, lap slide, best pulse, dialog scale; reduced motion on (OS setting)
- [ ] Desktop keyboard: Space/Enter primary action, Esc closes dialogs, Tab order, key hints
- [ ] Every gallery state (`?gallery`, 37 presets) opened and looks right
- [ ] 600-lap preset scrolls smoothly (slow Android)
- [ ] Get Ready: START size (compact), preview fit; Configuration two-column on tablet
- [ ] Sim strip height in portrait (56 px) — too much?

## Real-camera preview (3.3, `?` without `cam=fake`)

- [ ] Get Ready preview shows, front camera mirrored, ROI overlay aligned
- [ ] iOS Safari: preview survives the shared `<video>` moving between hidden host and Get Ready slot
- [ ] iOS installed PWA: does the camera permission re-prompt on each launch? Does the preview survive?
- [ ] Android: permission blocked → card text; allow in settings → app visible again retries
- Notes / guide text draft:

## Findings

| # | Device | Where (state id) | Finding | Severity | Status / PR |
|---|---|---|---|---|---|
| 1 | | | | | |

## Sign-off

- [ ] No open **must** items
- [ ] Spec §3/§4 updated for UX changes
- [ ] Signed off by the owner: ____ (date)
