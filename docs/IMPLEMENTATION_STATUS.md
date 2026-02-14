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
- [ ] Phase 3: Implement save providers (manual first, connector bridge behind feature flag).
  - [x] Manual provider baseline implemented with explicit `manual_required` confirmation workflow.
  - [x] Provider settings + diagnostics storage added (`providerSettings`, `providerDiagnostics`).
  - [x] Connector bridge feature flag + health check + automatic fallback to manual provider wired.
  - [ ] Connector bridge snapshot save command against Zotero internal bridge is still pending.
- [ ] Phase 4: Add diagnostics, contract tests, and hardening.

## Phase 3 Notes (Current)

- Queue save step now uses provider selection instead of hardcoded pause logic.
- Manual provider now opens/activates the queue tab, sets queue item to `manual_required`, and waits for user confirmation.
- Side panel now includes per-item `Mark Saved` / `Mark Failed` actions to complete manual-required queue items and continue queue progression.
- Added integration section in side panel with connector-bridge experimental toggle and live provider diagnostics.
- Connector bridge provider is currently a guarded placeholder that reports unavailable and falls back to manual mode.
