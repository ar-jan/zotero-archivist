# Implementation Status

Last updated: 2026-02-14

## Phase 0 Vertical Slice

- [x] Scaffolded core extension files:
  - [x] `manifest.json`
  - [x] `background/service-worker.js`
  - [x] `sidepanel/panel.html`
  - [x] `sidepanel/panel.js`
  - [x] `sidepanel/panel.css`
  - [x] `content/collector.js`
  - [x] `shared/protocol.js`
- [x] Wired toolbar action to toggle side panel via `chrome.sidePanel.setPanelBehavior()`.
- [x] Wired background runtime message routing for panel <-> background <-> content flow.
- [x] Implemented `Collect Links` end-to-end:
  - [x] Side panel sends `COLLECT_LINKS`.
  - [x] Background injects `content/collector.js` via `chrome.scripting.executeScript`.
  - [x] Collector normalizes and returns links.
  - [x] Side panel renders collected results.
- [x] Added storage in `chrome.storage.local` for:
  - [x] Selector rules
  - [x] Collected links
- [x] Added optional host permission request flow at collection time.

## Phase 0 Definition of Done

- [x] Unpacked extension loads successfully.
- [x] Clicking toolbar action toggles the side panel.
- [x] Clicking `Collect Links` shows links from the active page.

## Next Phases

- [x] Phase 1: Build selector management UI.
- [x] Phase 1: Build link curation controls (select/deselect/filter).
- [x] Phase 1: Implement queue authoring from selected links.
- [x] Phase 2: Implement MV3-safe queue engine with persisted state transitions.
- [x] Phase 3: Implement save providers (connector bridge behind feature flag).
  - [x] Provider settings + diagnostics storage added (`providerSettings`, `providerDiagnostics`).
  - [x] Connector bridge feature flag + health check + failure diagnostics wired.
  - [x] Connector bridge snapshot save command wired through Zotero `chromeMessageIframe` service-worker bridge.
- [ ] Phase 4: Add diagnostics, contract tests, and hardening.

## Phase 3 Notes (Current)

- Queue save step now uses provider selection instead of hardcoded pause logic.
- Queue save flow is fully automated; failed saves move items directly to `failed` with details.
- Added integration section in side panel with connector-bridge toggle and live provider diagnostics.
- Connector bridge provider now probes and executes `Connector_Browser.saveAsWebpage(..., { snapshot: true })` via the iframe/port bridge.
- Bridge failures now fail closed and expose reason details in diagnostics.

## Maintainability Refactor (2026-02-14)

- Centralized shared queue/link/runtime normalization in `shared/state.js` and removed duplicated panel/background implementations.
- Split background runtime concerns into modules:
  - `background/storage-repo.js`
  - `background/provider-orchestrator.js`
  - `background/queue-engine.js`
  - `background/queue-lifecycle.js`
  - `background/message-router.js`
- Split sidepanel support concerns into modules:
  - `sidepanel/store.js`
  - `sidepanel/actions.js`
  - `sidepanel/render.js`
- Added contract-style tests for shared normalization and routing behavior in `tests/shared-state.test.mjs`.
- Added queue-engine transition tests in `tests/queue-engine.test.mjs` covering:
  - pending -> opening_tab
  - active save success/failure
  - alarm timeout failure handling
  - active tab removal handling
  - recovery resume behavior
- Added lifecycle command tests in `tests/queue-lifecycle.test.mjs` covering:
  - start/pause/resume command behavior
  - stop command cancellation/cleanup behavior
  - retry-failed command reset behavior
- Added provider contract tests:
  - `tests/provider-orchestrator.test.mjs` for provider selection and diagnostics propagation.
  - `tests/provider-connector-bridge.test.mjs` for health/save contract semantics.
  - `tests/test-helpers/bridge-chrome-mock.mjs` for deterministic bridge/chrome API mocking.

## Post-Refactor TODOs

- [ ] Phase 4: Add diagnostics, contract tests, and hardening.
  - Why: This is the remaining planned phase and the main gap between feature completion and production readiness.

- [x] Add queue-engine transition tests.
  - Scope:
    - `background/queue-engine.js` transitions for pending tab open, save success/failure, timeout, tab removal, and recovery.
  - Why: Queue behavior is stateful and event-driven; regressions are likely without targeted transition tests.

- [x] Add lifecycle command tests for start/pause/resume/stop/retry flows.
  - Scope:
    - Message-handler/service-worker command behavior that controls queue runtime and item retry/reset semantics.
  - Why: These user-triggered control paths are critical operational behavior and should be validated independently from queue-engine internals.

- [x] Add provider-orchestrator and connector-bridge contract tests.
  - Scope:
    - `background/provider-orchestrator.js` provider resolution and diagnostics updates.
    - `zotero/provider-connector-bridge.js` health-check and save error semantics.
  - Why: Connector internals are unofficial/volatile, so contract tests provide early warning when bridge assumptions break.

- [ ] Expand diagnostics UX and add a bridge compatibility kill switch.
  - Scope:
    - Keep diagnostics visible/actionable in the panel.
    - Add a straightforward runtime disable path for connector bridge regressions.
  - Why: When connector behavior changes, users need clear failure context and a safe fallback switch.

- [ ] Resolve settings-path mismatch (implement or remove).
  - Scope:
    - Either wire provider settings controls from panel to `SET_PROVIDER_SETTINGS`, or remove dead surface area until needed.
  - Why: Partially wired paths increase maintenance cost and create confusion about supported configuration.

- [ ] Continue splitting sidepanel orchestration into smaller controllers.
  - Scope:
    - Incrementally separate selector editing, link curation, and queue lifecycle orchestration in `sidepanel/panel.js`.
  - Why: Smaller feature-focused modules improve readability, lower merge conflict risk, and make testing easier.

- [ ] Add a stable test command entrypoint.
  - Scope:
    - Add a small `package.json` script (or equivalent documented command) for running the test suite consistently.
  - Why: A single repeatable command reduces friction in CI and local verification workflows.
