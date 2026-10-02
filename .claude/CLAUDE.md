# Drone Lap Counter

Browser PoC that counts drone laps by detecting motion in a camera ROI. Spec: [docs/brainstorm.md](docs/brainstorm.md). Build plan: [docs/dev-plan.md](docs/dev-plan.md) — follow its phase/task order and "done when" criteria.

## Stack & layout
- Code lives in `drone-lap-poc/`: vanilla JS ES modules, Vite, `node:test`. Dev dependency is only `vite`; no runtime deps.
- Commands (run in `drone-lap-poc/`): `npm run dev`, `npm run build`, `npm run preview`, `npm test`.

## Rules
- Keep pure logic (`detector.js`, diff core of `motion.js`, calibration) free of DOM access so it runs under `node --test`. Write tests with the module.
- Camera access only in `source.js`. No Node APIs in `src/`. `vite.config.js` keeps `base: './'` (PWA-safe).
- No per-frame allocation in the frame loop: caller-allocated buffers, swap don't copy.
- File sources use `mediaTime * 1000` as timestamp, not wall clock.
- Detector behavior follows dev-plan §5 clarifications; each has a test.
- Don't add dependencies or features outside the plan (see brainstorm §5 backlog) without asking.
- Every step ends runnable, with tests green, then a commit.
- Keep code and comments concise; match the existing style.
