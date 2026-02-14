# Repository Guidelines

## Project Structure & Module Organization
- `manifest.json`: MV3 extension entrypoint and permission model.
- `background/`: service-worker runtime (`message-router`, queue engine/lifecycle, storage repo, provider orchestration).
- `sidepanel/`: panel UI (`panel.html/css/js`) plus focused controllers and store/render modules.
- `content/collector.js`: on-demand page link collection logic.
- `shared/`: cross-surface contracts and state normalization utilities.
- `zotero/`: provider interface and connector bridge implementation.
- `tests/`: module-level `node:test` suites and `tests/test-helpers/` mocks.
- `docs/`: architecture and implementation status docs used for scope control.

## Build, Test, and Development Commands
- `npm install`: install local Node dependencies.
- `npm test`: run all tests (`node --test tests/*.mjs`).
- `npm run test:watch`: rerun tests on file changes.
- No bundling/build step is configured. For manual validation, load the repo root in Chromium via `chrome://extensions` -> **Developer mode** -> **Load unpacked**.

## Coding Style & Naming Conventions
- Language/runtime: modern JavaScript ES modules (`import`/`export`), MV3 service worker.
- Formatting: 2-space indentation, semicolons, double quotes, trailing commas where already used.
- Naming: files in kebab-case (for example, `queue-engine.js`); functions/variables in camelCase; exported constants in UPPER_SNAKE_CASE.
- Keep shared contracts in `shared/protocol.js` and shared normalization/state helpers in `shared/state.js`.
- No eslint/prettier config is committed; match surrounding style and keep modules narrowly focused.

## Testing Guidelines
- Framework: Node built-in `node:test` with `node:assert/strict`.
- Test files: `tests/*.test.mjs` (one module/feature area per file).
- Prefer deterministic mocks from `tests/test-helpers/` for Chrome/Zotero bridge behaviors.
- When changing queue, routing, or provider code, add/adjust tests for state transitions, message contracts, and failure paths.
- Run `npm test` before opening a PR.

## Commit & Pull Request Guidelines
- Commit subjects in recent history are short, imperative, and sometimes scoped (`Maintenance: ...`, `Refactor: ...`).
- Example style: `Maintenance: add storage-repo coverage`.
- PRs should include: concise summary, rationale, test evidence (`npm test`), and screenshots for `sidepanel/` UI changes.
- Link related issue/task when available and highlight any permission or `manifest.json` changes explicitly.

## Security & Configuration Tips
- Preserve least-privilege permissions; prefer runtime host permission requests over broad defaults.
- Avoid always-on content script injection unless explicitly required.
- Keep implementation scope aligned with `docs/IMPLEMENTATION_STATUS.md` and `docs/ARCHITECTURE.md`.
