# Zotero Archivist: Modern Chromium Architecture and Implementation Plan

## 1) Re-evaluation Summary

1. Use native `chrome.sidePanel` as the primary UI surface.
2. Keep content-script work on-demand, not always injected.
3. Use least-privilege permissions and optional host access flow.
4. Make queue orchestration resilient to MV3 service worker suspension.
5. Isolate Zotero integration behind provider adapters with explicit fallback modes.

## 2) Product Requirements

1. Side panel for workflow controls.
2. User-customizable panel width.
3. Collect URLs from page using configured selectors.
4. Select/deselect collected links for archival queue.
5. Archive each selected URL with **Save to Zotero (Web Page with Snapshot)** behavior.

## 3) Browser-Platform Decisions

## 3.1 Side panel implementation

1. Primary: use Chrome/Chromium `chrome.sidePanel`.
2. Width handling: native side panel is user-resizable by browser chrome; extension does not manage pixel width directly.
3. No compatibility-mode in-page panel; `chrome.sidePanel` is the only supported UI surface.

## 3.2 MV3 runtime model

1. Background logic runs in a service worker and must be restart-safe.
2. Long-running queue operations are modeled as resumable state transitions.
3. No assumptions of in-memory persistence across worker sleeps.

## 4) Zotero Connector Reality Check (from local `zotero-connectors/`)

1. The "Web Page with Snapshot" action maps to:
   - `saveAsWebpage(tab, 0, { snapshot: true })`
   - source: `zotero-connectors/src/browserExt/background.js:692`
2. There is no public external extension API:
   - no `externally_connectable`
   - no `onMessageExternal`
   - source: `zotero-connectors/src/browserExt/manifest-v3.json:1`
3. There is an undocumented internal message bridge via web-accessible iframe:
   - `chromeMessageIframe/messageIframe.html`
   - source: `zotero-connectors/src/browserExt/manifest-v3.json:46`
4. Conclusion: integration must treat connector internals as volatile and provide fallback.

## 5) Target Architecture

## 5.1 Components

1. `sidepanel/` app
   - Selector rules UI
   - Link review + selection
   - Queue controls and status
   - Integration diagnostics (connector detected, mode, last error)

2. `background/service-worker.js`
   - Queue state machine
   - Tab lifecycle management
   - Save provider orchestration
   - Persistence + recovery

3. `content/collector.js` (on-demand)
   - Injected only when collecting links
   - Evaluates selector rules and returns normalized candidates

4. `zotero/`
   - `provider-interface.js` shared provider contracts + diagnostics normalization
   - `provider-connector-bridge.js` (default provider)

5. `shared/protocol.js`
   - Message types, storage keys, and normalization helpers for runtime contracts

6. `background/message-router.js`
   - Runtime message boundary checks for type + payload shape before handler dispatch

## 5.2 Recommended structure

```txt
zotero-archivist/
├── manifest.json
├── background/
│   ├── service-worker.js
│   ├── message-router.js
│   ├── queue-lifecycle.js
│   ├── storage-repo.js
│   ├── provider-orchestrator.js
│   └── queue-engine.js
├── sidepanel/
│   ├── panel.html
│   ├── panel.css
│   ├── panel.js
│   ├── store.js
│   ├── actions.js
│   ├── render.js
│   ├── queue-controller.js
│   ├── selector-controller.js
│   └── link-curation-controller.js
├── content/
│   └── collector.js
├── zotero/
│   ├── provider-interface.js
│   └── provider-connector-bridge.js
├── shared/
│   ├── protocol.js
│   └── state.js
└── docs/
    └── ARCHITECTURE.md
```

## 6) Permission and Manifest Best Practices

## 6.1 Manifest

1. `manifest_version: 3`
2. `action` for quick open + status icon
3. `side_panel.default_path` for primary UI
4. `background.service_worker` only; no persistent background page

## 6.2 Permissions strategy (least privilege)

1. Required:
   - `storage`
   - `alarms` (required once queue engine watchdog is enabled)
   - `tabs`
   - `scripting`
   - `sidePanel`
2. Optional (deferred in current implementation):
   - `management` is not used; connector availability is inferred via bridge probe behavior
3. Host permissions:
   - prefer `optional_host_permissions`: `https://*/*`, `http://*/*`
   - request at runtime when user starts collection or starts/resumes queue processing, not at install

## 6.3 What to avoid

1. Avoid always-on `<all_urls>` content scripts.
2. Avoid DOM-injected iframe sidebars as default UI.
3. Avoid relying on service-worker memory for queue state.

## 7) Data Contracts

```ts
type SelectorRule = {
  id: string;
  name: string;
  cssSelector: string;
  urlAttribute: string; // default "href"
  includePattern?: string;
  excludePattern?: string;
  enabled: boolean;
};

type LinkCandidate = {
  id: string;
  url: string;
  title: string;
  sourceSelectorId: string;
  selected: boolean;
  dedupeKey: string;
};

type CollectorSettings = {
  maxLinksPerRun: number; // default 500, clamped to [1, 5000]
};

type QueueItemStatus =
  | "pending"
  | "opening_tab"
  | "saving_snapshot"
  | "archived"
  | "failed"
  | "cancelled";

type QueueItem = {
  id: string;
  url: string;
  title: string;
  status: QueueItemStatus;
  attempts: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
};

type SaveProviderMode = "connector_bridge";
```

## 8) Queue Engine (MV3-safe)

Use a deterministic state machine with persisted checkpoints.

1. Store durable queue state in `chrome.storage.local`.
2. Store queue runtime pointers (`status`, `activeQueueItemId`, `activeTabId`) in `chrome.storage.local` for restart safety.
3. `chrome.storage.session` mirrors are not currently used.
4. Use event-driven progression:
   - `tabs.onUpdated` for load-complete
   - `tabs.onRemoved` for unexpected queue tab closure
   - explicit step commits per item
5. Use `chrome.alarms` for watchdog/retry and recovery after worker suspend.
6. Default concurrency = `1` for predictable Zotero behavior.

State transitions:

1. `pending -> opening_tab -> saving_snapshot -> archived`
2. `saving_snapshot -> failed` on provider or bridge errors
3. Any active state -> `failed` on terminal error/timeout
4. Any active state -> `cancelled` when operator stops queue

Current Phase 3 behavior (2026-02-14):

1. Queue controls (`start`, `pause`, `resume`, `stop`, `retry failed`) are wired in the side panel and background runtime.
2. `pending -> opening_tab -> saving_snapshot` now routes through provider orchestration in background.
3. Queue save completion/failure is fully automated; there is no user-confirmation queue state.
4. Connector bridge is health-checked; when unavailable, save attempts fail with explicit diagnostics.
5. Queue `start`/`resume` performs host-permission preflight for queued origins before lifecycle dispatch.

## 9) URL Collection Flow

1. User clicks "Collect Links" in side panel.
2. Background injects `content/collector.js` into active tab via `chrome.scripting.executeScript`.
3. Collector applies enabled selector rules and returns normalized URLs.
4. Background dedupes and sends candidates to side panel store.
5. User curates selection and submits queue.

Collector best practices:

1. Enforce protocol allowlist (`http`, `https`).
2. Resolve relative URLs against `document.baseURI`.
3. Cap max collected links per run via `collectorSettings.maxLinksPerRun` (default `500`, clamped to `[1, 5000]`).
4. Return metadata only; no unnecessary DOM capture.

## 10) Zotero Save Provider Strategy

Treat Zotero save path as a pluggable provider with capability checks.

## 10.1 Provider interface

```ts
interface ZoteroSaveProvider {
  mode: SaveProviderMode;
  checkHealth(input?: { tabId?: number }): Promise<{
    ok: boolean;
    message: string;
    connectorAvailable: boolean | null;
    zoteroOnline: boolean | null;
  }>;
  saveWebPageWithSnapshot(input: { tabId: number; url: string; title?: string }): Promise<{
    ok: boolean;
    error?: string;
  }>;
}
```

## 10.2 Provider order

1. `connector_bridge` (if health check passes)

## 10.3 Connector bridge provider (advanced)

1. Uses Zotero internal iframe bridge endpoint discovered in analysis.
2. Sends save command equivalent to connector snapshot action.
3. Guardrails:
   - strict timeout
   - compatibility/version probes
   - fail-closed behavior with explicit diagnostics

## 10.4 Connector completion semantics

1. Archivist treats a bridge call as successful when `Messaging.sendMessage("saveAsWebpage", ...)` resolves without throwing.
2. Archivist treats connector rejection/throw as a save failure.
3. There is no stable external callback that confirms completion beyond this bridge response contract.
4. Connector popup events (for example `progressWindow.done`) are internal connector messages and are not used as Archivist success signals.
5. This contract is based on current connector internals and should be revalidated when connector versions change.

## 10.5 Failure handling

1. Queue items move to `failed` when save commands error or time out.
2. Errors are surfaced in queue item `lastError` and provider diagnostics.
3. Retry flow requeues failed/cancelled items after operator action.

## 10.6 Diagnostics probe preconditions

1. When no queue tab id is supplied, connector health probes require at least one open `http(s)` tab with granted host permission.
2. If no eligible tab is available, diagnostics report a probe-precondition error rather than a connector-state verdict.

## 11) Side Panel UX Plan

1. Sections:
   - Source selectors
   - Collected links
   - Queue
   - Integration status
2. Selection controls:
   - select all
   - clear all
   - invert
   - search/filter
3. Queue controls:
   - start
   - pause
   - resume
   - stop
   - retry failed
4. Operational clarity:
   - current mode (`connector_bridge`)
   - active Zotero detection state
   - explicit warnings on degraded mode

## 12) Storage Plan

1. `chrome.storage.local`:
   - selector rules (`selectorRules`)
   - collected links (`collectedLinks`)
   - collector settings (`collectorSettings`)
   - queue items (`queueItems`)
   - queue runtime (`queueRuntime`)
   - provider diagnostics (`providerDiagnostics`)
2. `chrome.storage.sync`:
   - not currently used
3. `chrome.storage.session`:
   - not currently used

## 13) Security and Privacy

1. No remote code execution or dynamic script URLs.
2. Validate inbound runtime message payload shape at routing boundaries and normalize persisted state payloads.
3. Do not persist full page content in archivist storage.
4. Minimize retained data (URLs/titles/status only).
5. Redact sensitive query params in logs/UI where appropriate.

## 14) Testing Strategy

1. Automated module tests (`node:test`):
   - selector/filtering and URL normalization
   - message-router contract checks
   - queue lifecycle + queue engine state transitions
   - provider orchestration and connector bridge behaviors via mocks
   - storage normalization and sidepanel controllers/store
2. Extension-level validation:
   - manual load-unpacked workflow checks in Chromium (collection, queue controls, diagnostics)
3. Connector contract checks:
   - mocked bridge health/save coverage in automated tests
   - optional manual smoke test against local Zotero connector (only when explicitly requested)

## 15) Implementation Phases (Current Status)

### Phase 0: Foundation choices (completed)

1. Scaffold MV3 + sidePanel + typed message protocol.
2. Implement storage abstractions and queue state reducer.

### Phase 1: Link collection workflow (completed)

1. Build selector UI.
2. Implement on-demand collector injection.
3. Implement selection and queue authoring.

### Phase 2: Queue engine (completed)

1. Implement tab lifecycle controller.
2. Implement pause/resume/stop/retry and recovery logic.
3. Add alarm-based watchdog handling.

### Phase 3: Save providers (completed)

1. Implement `connector_bridge` provider.
2. Add health checks and explicit failure diagnostics.

### Phase 4: Hardening (partially complete)

1. Diagnostics panel and provider-status refresh controls are implemented.
2. Runtime routing/storage normalization tests are implemented at module level.
3. Contract tests against a live installed connector remain manual/optional.

## 16) Delivery Guardrails

These rules are normative and are intended to prevent unrequested scope creep.

1. Treat this document as baseline architecture context; prioritize user-reported issues and explicitly requested features for active scope.
2. Do not implement optional/deferred items unless they are explicitly requested in the current task.
3. New runtime message types, storage keys, or side-panel controls require explicit user approval.
4. If scope is ambiguous, stop and confirm before implementing.

## 17) MVP Definition (Best-Practice Baseline)

MVP should be considered complete when:

1. Side panel workflow is fully functional using native `chrome.sidePanel`.
2. URL collection and curation are stable on modern sites.
3. Queue is restart-safe under MV3 worker suspension.
4. Connector bridge mode is enabled by default and provides clear diagnostics on failure.
