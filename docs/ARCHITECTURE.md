# Zotero Archivist Architecture (As Implemented)

## 1. Purpose and Scope
This document describes the current architecture of Zotero Archivist as implemented in the repository.

Scope includes:
- Runtime surfaces and component boundaries.
- State and storage model.
- Link collection, queue processing, and Zotero save flows.
- Reliability, security, and permission choices.
- Intentional tradeoffs and extension points.

This document is architectural reference, not an implementation plan.

## 2. System Overview
Zotero Archivist is a Manifest V3 Chromium extension with four primary runtime surfaces:

1. Side panel UI (`sidepanel/`)
2. Background service worker (`background/service-worker.js`)
3. On-demand content collector script (`content/collector.js`)
4. Zotero provider adapter (`zotero/`)

Shared contracts and normalization logic are centralized in:
- `shared/protocol.js`
- `shared/state.js`

All durable extension state is persisted in `chrome.storage.local`.

## 3. Component Architecture

### 3.1 Manifest and Browser Integration
`manifest.json` defines:
- MV3 service worker background.
- Native side panel UI (`side_panel.default_path`).
- Required permissions: `storage`, `alarms`, `tabs`, `scripting`, `sidePanel`.
- Optional host permissions for `http://*/*` and `https://*/*`.

The browser action opens the side panel via `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`.

### 3.2 Side Panel Application
The side panel is a modular UI app composed of:
- Entry/orchestration: `sidepanel/panel.js`
- Runtime message actions: `sidepanel/actions.js`
- Local panel store: `sidepanel/store.js`
- Rendering utilities: `sidepanel/render.js`
- Focused controllers:
  - `sidepanel/selector-controller.js`
  - `sidepanel/link-curation-controller.js`
  - `sidepanel/queue-controller.js`

Responsibilities:
- Manage selector rules.
- Collect and curate links.
- Author and control queue lifecycle.
- Show integration diagnostics.
- Keep UI synchronized with background state via `chrome.storage.onChanged`.

### 3.3 Background Service Worker
`background/service-worker.js` is the system orchestrator.

Responsibilities:
- Initialize normalized storage state on install/startup.
- Route and validate runtime messages.
- Trigger content collection in the active tab.
- Manage queue lifecycle commands.
- Run queue engine and recovery behavior.
- Refresh/save provider diagnostics.

Supporting modules:
- `background/message-router.js`: message contract validation and handler dispatch.
- `background/storage-repo.js`: storage read/write + normalization/write-back.
- `background/queue-lifecycle.js`: start/pause/resume/stop/clear/retry control semantics.
- `background/queue-engine.js`: deterministic queue state machine.
- `background/provider-orchestrator.js`: provider resolution and save orchestration.

### 3.4 On-Demand Collector
`content/collector.js` is injected only when link collection is requested.

Responsibilities:
- Evaluate enabled selector rules against page DOM.
- Extract and normalize URLs.
- Apply include/exclude pattern filtering.
- Dedupe links within a run.
- Return lightweight candidate metadata to background.

The collector is not permanently injected.

### 3.5 Zotero Provider Layer
Provider abstractions live in `zotero/`:
- `provider-interface.js`: diagnostics and provider result normalization helpers.
- `provider-connector-bridge.js`: current active provider implementation.

Current provider mode:
- `connector_bridge`

The orchestrator health-checks the provider, persists diagnostics, and delegates save operations.

## 4. Runtime Data Contracts

### 4.1 Message Protocol
`shared/protocol.js` defines message types used across panel/background/collector.

Key message groups:
- Panel state and collection: `GET_PANEL_STATE`, `COLLECT_LINKS`, `RUN_COLLECTOR`.
- Link and selector updates: `SET_COLLECTED_LINKS`, `SET_SELECTOR_RULES`.
- Queue authoring/lifecycle: `AUTHOR_QUEUE_FROM_SELECTION`, `START_QUEUE`, `PAUSE_QUEUE`, `RESUME_QUEUE`, `STOP_QUEUE`, `CLEAR_QUEUE`, `RETRY_FAILED_QUEUE`.

`background/message-router.js` enforces payload contracts before dispatch.

### 4.2 State Shapes
`shared/state.js` defines normalization and queue semantics.

Queue item statuses:
- `pending`
- `opening_tab`
- `saving_snapshot`
- `archived`
- `failed`
- `cancelled`

Queue runtime statuses:
- `idle`
- `running`
- `paused`

Default collector setting:
- `maxLinksPerRun = 500` (clamped to `1..5000`)

Default queue pacing settings:
- `interItemDelayMs = 5000`
- `interItemDelayJitterMs = 2000` (effective delay range is about `3..7s`)

### 4.3 Storage Model
Durable data in `chrome.storage.local`:
- `selectorRules`
- `collectedLinks`
- `collectorSettings`
- `queueSettings`
- `queueItems`
- `queueRuntime`
- `providerDiagnostics`

`background/storage-repo.js` normalizes data on read and writes back normalized values (self-healing). It also migrates a legacy selector default shape to current defaults.

## 5. Core Flows

### 5.1 Link Collection Flow
1. Side panel requests collection.
2. Panel ensures host permission for active tab origin.
3. Background validates active tab and permission state.
4. Background injects `content/collector.js` with `chrome.scripting.executeScript`.
5. Background sends `RUN_COLLECTOR` message with selector rules and max link cap.
6. Collector returns normalized link candidates.
7. Background persists candidates and returns updated diagnostics.
8. Panel renders and enables curation actions.

### 5.2 Link Curation and Queue Authoring
1. User selects/deselects collected links in panel.
2. Link curation controller persists curated selection via `SET_COLLECTED_LINKS`.
3. Queue controller sends selected links via `AUTHOR_QUEUE_FROM_SELECTION`.
4. Background dedupes against existing queue URLs and appends new `pending` queue items.

### 5.3 Queue Processing Flow
1. User starts/resumes queue from side panel.
2. Queue controller preflights host permissions for relevant queued URLs.
3. Background queue lifecycle sets runtime to `running` and triggers queue engine.
4. Queue engine promotes next `pending` item to `opening_tab`, opens a background tab, and stores active runtime pointers.
5. On tab completion (`tabs.onUpdated`) queue engine transitions item to `saving_snapshot`.
6. Engine calls provider orchestrator to save with snapshot behavior.
7. Success path: mark `archived`, close tab, clear active runtime pointers, continue.
8. Failure path: mark `failed` with `lastError`, close tab, clear active pointers, continue.
9. Between completed items, engine applies configurable pacing delay + jitter before opening the next pending item.
10. If no pending items remain, runtime returns to `idle`.

### 5.4 Diagnostics Flow
1. `GET_PANEL_STATE` refreshes provider diagnostics.
2. Provider orchestrator runs health checks and persists normalized diagnostics.
3. Side panel renders mode, bridge health, connector availability, Zotero online status, and last error.

## 6. Queue Engine Design
`background/queue-engine.js` implements a serialized, restart-safe state machine.

Key design choices:
- Single active queue item at a time (`activeQueueItemId`, `activeTabId`).
- Serialized runs through `runQueueEngineSoon` promise chaining to avoid concurrent mutations.
- Event-driven progression via:
  - `chrome.tabs.onUpdated`
  - `chrome.tabs.onRemoved`
  - `chrome.alarms` watchdog (`queue-engine-watchdog`)
- Alarm timeout handling marks stuck/closed active items as failed.
- Recovery on worker startup (`recoverQueueEngineState`) resumes engine if runtime status is `running`.

Lifecycle operations in `background/queue-lifecycle.js` enforce control semantics:
- `start`: requires pending work, rejects paused runtime.
- `pause`: only when running, clears alarm.
- `resume`: only when paused and work exists.
- `stop`: cancels active item if needed, resets runtime, closes active tab.
- `retry failed`: moves `failed` and `cancelled` back to `pending`.
- `clear`: allowed only when not running.

## 7. Zotero Connector Bridge Design
The implemented provider (`zotero/provider-connector-bridge.js`) uses a bridge to Zotero Connector internals.

Health strategy:
- Resolve a probe tab with `http(s)` URL and granted host permission.
- Run `Connector.checkIsOnline` through the bridge.
- Emit diagnostics for:
  - Connector extension unavailable
  - Connector available but Zotero offline
  - Healthy connector + Zotero online

Save strategy for each queue item:
1. Resolve queue tab metadata.
2. Run `Connector_Browser.injectTranslationScripts`.
3. Run `Connector.checkIsOnline`.
4. Run `Messaging.sendMessage("saveAsWebpage", [title, { snapshot: true }], tabId, 0)`.

Bridge invocation model:
- `chrome.scripting.executeScript` injects a helper into the queue tab.
- Helper loads Zotero's internal iframe bridge endpoint.
- Helper opens a `MessageChannel`, sends command payloads, and enforces timeouts.
- Provider fails closed with explicit error messages on bridge failures.

## 8. Permission and Security Model
Least-privilege principles are implemented as:
- Optional host permissions requested at runtime per origin.
- Collection blocked when site permission is missing.
- Queue start/resume preflights permissions for queued URLs.
- No always-on content script; collector is injected on demand.

Data and message safety:
- Runtime message shape validation in `message-router`.
- Strict normalization of all persisted state (`storage-repo`, `shared/state`).
- Persisted data is limited to selector rules, link metadata, queue/runtime state, and diagnostics.
- No page DOM/content snapshots are stored by Archivist.

## 9. Observability and UI Feedback
User-facing state visibility includes:
- Global status line messages for all major actions.
- Queue item status badges, attempts, and last error.
- Queue runtime status text (`idle`, `running`, `paused`).
- Integration diagnostics section with connector/zotero availability breakdown and last error.

Background state changes to queue and diagnostics are reflected live in the panel through `chrome.storage.onChanged`.

## 10. Testing Strategy
The project uses module-level tests with Node's built-in test runner (`node:test`).

Covered areas include:
- Message routing validation.
- Shared state normalization/helpers.
- Storage normalization/write-back behavior.
- Queue lifecycle handlers.
- Queue engine state transitions and watchdog behavior.
- Provider orchestration and connector bridge behavior via mocks.
- Side panel controllers and store behavior.

This test strategy emphasizes deterministic module contracts and mocked browser/provider integrations.

## 11. Intentional Tradeoffs and Current Constraints
Current architecture intentionally favors reliability and clarity over breadth.

Intentional constraints:
- Single provider mode (`connector_bridge`).
- Single-item queue processing (no concurrent save workers).
- `chrome.storage.local` only (no `sync`/`session` usage).
- Side panel is the only UI surface.

Tradeoffs:
- Connector integration depends on non-public connector internals, so diagnostics and explicit failure handling are prioritized.
- Permission preflights can add interaction steps, but preserve least privilege.
- Queue processing is conservative (serialized) to minimize cross-tab/provider complexity.

## 12. Extension Points
The current design leaves clear seams for evolution:
- Add provider implementations behind `provider-orchestrator`.
- Extend message protocol in `shared/protocol.js` and router contract checks.
- Introduce additional queue policies (for example backoff/retry strategy) in `queue-engine`/`queue-lifecycle`.
- Expand panel modules without coupling rendering, state, and action logic.
