# Zotero Archivist: High-Level Architecture and Implementation Plan

## 1) Scope

Build a Chromium extension that:

1. Shows a side panel with user-customizable width.
2. Collects links from the current page via configured CSS selectors.
3. Lets users select/deselect links for archival.
4. Opens selected URLs in a queue and archives each as **"Web Page with Snapshot"** via the installed Zotero Connector.

This document is updated based on local analysis of `zotero-connectors/`.

## 2) Connector Analysis Findings (from `zotero-connectors/`)

### 2.1 Save action mapping

1. The Zotero context-menu item **"Save to Zotero (Web Page with Snapshot)"** maps to:
   - menu id `zotero-context-menu-webpage-withSnapshot-save`
   - handler `Zotero.Connector_Browser.saveAsWebpage(tab, 0, { snapshot: true })`
   - source: `zotero-connectors/src/browserExt/background.js:692`
2. `saveAsWebpage()` triggers message `"saveAsWebpage"` into Zotero's content script:
   - source: `zotero-connectors/src/browserExt/background.js:1110`
3. The content side handles this in `PageSaving.onSaveAsWebpage()`, then runs snapshot save flow:
   - source: `zotero-connectors/src/common/inject/inject.jsx:116`
   - source: `zotero-connectors/src/common/inject/pageSaving.js:627`
   - source: `zotero-connectors/src/common/inject/pageSaving.js:370`

### 2.2 No public cross-extension API

1. Chromium manifest has no `externally_connectable` entry:
   - source: `zotero-connectors/src/browserExt/manifest-v3.json:1`
2. Codebase does not register `runtime.onMessageExternal`/`onConnectExternal`.
3. Result: there is no official stable API for another extension to request save actions directly.

### 2.3 Internal bridge exists (undocumented)

1. Zotero exposes a web-accessible iframe endpoint:
   - `chromeMessageIframe/messageIframe.html`
   - source: `zotero-connectors/src/browserExt/manifest-v3.json:46`
2. That iframe forwards `sendToBackground` requests to Zotero service worker via `postMessage({ type: "inject-message", args })`:
   - source: `zotero-connectors/src/browserExt/chromeMessageIframe/messageIframe.js:39`
3. The service worker accepts `inject-message` and calls `Zotero.Messaging.receiveMessage(...)`:
   - source: `zotero-connectors/src/common/messaging.js:173`

This internal bridge can be used by `zotero-archivist`, but it is not a documented public contract and may break across connector updates.

### 2.4 Collection targeting limitations

1. Snapshot save payload for `saveSnapshot` does not include explicit collection key in this flow:
   - source: `zotero-connectors/src/common/inject/pageSaving.js:339`
2. Connector reads current selected target from Zotero client (`getSelectedCollection`), but this code path does not expose a clean public "set collection and save" API for other extensions.
3. Practical MVP assumption: user selects destination collection in Zotero client/connector; archivist uses that active target.

## 3) Proposed Architecture

## 3.1 Core components

1. `content/host.js`
   - Injects side panel iframe and resize handle.
   - Persists panel width in `chrome.storage.local`.
   - Runs selector-based link collection on active page.

2. `panel/` UI
   - Rule editor for selectors.
   - Link list with select/deselect controls.
   - Queue controls and per-item status.

3. `background/service-worker.js`
   - Queue orchestrator and state machine.
   - Opens URLs in tabs and coordinates archival attempts.
   - Persists queue/runtime state for recovery.

4. `connector/bridgeClient.js` (new)
   - Connects to Zotero connector internal iframe bridge.
   - Sends validated command envelopes to Zotero worker.
   - Returns success/failure payloads to archivist background.

5. `connector/adapter.js`
   - High-level adapter with two modes:
     - `bridge-snapshot` (primary)
     - `manual-confirm` (fallback)

## 3.2 Updated project structure

```txt
zotero-archivist/
├── manifest.json
├── background/
│   └── service-worker.js
├── content/
│   ├── host.js
│   ├── collector.js
│   └── connector-bridge-host.js
├── panel/
│   ├── panel.html
│   ├── panel.css
│   ├── panel.js
│   └── state.js
├── connector/
│   ├── adapter.js
│   ├── bridgeClient.js
│   ├── protocol.js
│   └── manualAdapter.js
└── docs/
    └── integration-notes.md
```

## 4) Connector Bridge Design

## 4.1 Bridge handshake

1. Discover Zotero connector extension ID:
   - preferred: user-configured setting
   - optional enhancement: `chrome.management` assisted lookup
2. Inject hidden iframe:
   - `chrome-extension://<zoteroExtensionId>/chromeMessageIframe/messageIframe.html`
3. Create `MessageChannel` and send `"zoteroChannel"` handshake to iframe.
4. Use established port as RPC transport.

## 4.2 Primary command for snapshot save

Use Zotero message bus entry that returns completion response:

1. Call `Messaging.sendMessage` through bridge with target tab:
   - message name: `"saveAsWebpage"`
   - args: `[document.title, { snapshot: true, resave: true }]`
   - target frame: `0`
2. Why this route:
   - invokes the same content-side save pipeline as connector UI save
   - with `snapshot: true` explicitly set
   - expected to resolve/reject based on save flow outcome

## 4.3 Preflight checks

Before queue start:

1. Verify bridge connectivity (iframe + channel alive).
2. Verify Zotero connectivity via connector (`Connector.checkIsOnline`).
3. Optionally read current target (`getSelectedCollection`) and show it in panel.

## 5) Queue Workflow (Updated)

Per selected URL:

1. Open URL in inactive tab.
2. Wait for page readiness.
3. Ensure connector bridge initialized for that tab context.
4. Execute save command with `{ snapshot: true, resave: true }`.
5. On resolve: mark `archived`.
6. On reject: mark `failed` with connector error.
7. Close tab (configurable if user wants to inspect failures).

Fallback behavior:

1. If bridge is unavailable or command fails with incompatibility, switch item to `manual_required`.
2. In manual mode, user opens tab and uses Zotero action/shortcut; archivist records manual confirmation.

## 6) Data Model Updates

```ts
type ConnectorConfig = {
  mode: "bridge-snapshot" | "manual-confirm";
  zoteroExtensionId: string;
  enableManagementDiscovery: boolean;
};

type ArchiveQueueItem = {
  id: string;
  url: string;
  title: string;
  status:
    | "pending"
    | "opening"
    | "bridge_init"
    | "saving_snapshot"
    | "archived"
    | "manual_required"
    | "failed";
  attempts: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
};
```

## 7) Permissions Plan

In `manifest.json` for `zotero-archivist`:

1. Required:
   - `permissions`: `storage`, `tabs`, `scripting`, `activeTab`
   - `host_permissions`: `http://*/*`, `https://*/*`
2. Optional:
   - `management` (only if we implement automatic Zotero extension discovery)

## 8) Implementation Plan

### Phase 1: Baseline Extension Shell

1. Scaffold MV3 extension, panel injection, and width persistence.
2. Deliverable: stable resizable side panel.

### Phase 2: Selector Collection + Selection UI

1. Implement selector rules editor and link collector.
2. Implement link curation UX (select all/none/invert/search).
3. Deliverable: curated candidate set ready for queue.

### Phase 3: Zotero Bridge PoC

1. Build `connector-bridge-host.js` handshake to Zotero message iframe.
2. Implement bridge RPC transport + timeout/error handling.
3. Validate:
   - bridge connectivity
   - `Connector.checkIsOnline`
   - one-page `"saveAsWebpage"` with `{ snapshot: true }`
4. Deliverable: verifiable end-to-end snapshot save via connector internals.

### Phase 4: Queue Integration

1. Integrate bridge adapter into queue state machine.
2. Add retries and deterministic failure states.
3. Persist queue/runtime for restart recovery.
4. Deliverable: automated queued snapshot archiving.

### Phase 5: Fallback + Collection UX

1. Add robust fallback to `manual-confirm`.
2. Show current Zotero target collection in sidebar before start.
3. Warn when target collection cannot be programmatically guaranteed.
4. Deliverable: predictable operator workflow even on unsupported pages.

### Phase 6: Hardening

1. Add integration tests for queue transitions and bridge command execution.
2. Add compatibility checks for connector updates (version probe + kill switch).
3. Document operational runbook in `docs/integration-notes.md`.
4. Deliverable: stable MVP with clear degradation behavior.

## 9) Risks and Mitigations

1. **Undocumented bridge may change**
   - Mitigation: capability probe + feature flag + manual fallback.
2. **Page CSP or edge cases may block iframe bridge**
   - Mitigation: per-item fallback to manual mode.
3. **No first-class collection targeting API in this path**
   - Mitigation: require user to set active Zotero target before run; show target in UI.
4. **Licensing risk if copying connector code**
   - Mitigation: implement bridge logic from browser APIs without vendoring connector source.

## 10) MVP Recommendation

Ship MVP as:

1. Resizable side panel.
2. Selector-driven link collection and curation.
3. Sequential queue.
4. Primary archival mode: Zotero internal bridge -> `saveAsWebpage(..., { snapshot: true })`.
5. Automatic fallback: manual-confirm for unsupported/failed bridge runs.

This gives the requested "Web Page with Snapshot" behavior while acknowledging connector API boundaries discovered in `zotero-connectors/`.
