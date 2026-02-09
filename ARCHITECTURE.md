# Zotero Archivist: High-Level Architecture and Implementation Plan

## 1) Objectives

1. Provide a side panel on any page, with user-customizable width.
2. Collect links from the active page based on user-configured CSS selectors.
3. Show collected links in the panel so users can select or deselect items to archive.
4. Run an archival queue that opens selected URLs and archives them to a Zotero collection through the installed Zotero browser plugin (integration details to be finalized).

## 2) Proposed Architecture

Use a Manifest V3 extension with four core runtime parts.

1. `content/host.js` (content script)
   - Injects and manages the in-page side panel container and resize handle.
   - Applies persisted panel width per site/global preference.
   - Executes selector-based link discovery on the current DOM.
   - Sends discovered links to the panel and background service worker.

2. `panel/` (iframe UI embedded by content script)
   - Main user interface for selector management, link review, and queue controls.
   - Supports bulk select/deselect and per-row toggles.
   - Displays queue progress and per-item status.

3. `background/service-worker.js`
   - Single source of truth for archival queue state.
   - Opens URLs in controlled tabs (initially sequential, optional bounded concurrency later).
   - Coordinates with Zotero integration adapter and updates item status.
   - Persists queue state in `chrome.storage.local` for recovery.

4. `zotero/adapter.js` (integration boundary)
   - Encapsulates all Zotero-specific logic behind a stable interface.
   - Supports multiple strategies as details become clear:
     - `connector-manual-confirm` (MVP-safe path).
     - `connector-automation` (if technically reliable and allowed).

## 3) Recommended Project Structure

```txt
zotero-archivist/
├── manifest.json
├── background/
│   └── service-worker.js
├── content/
│   ├── host.js
│   ├── collector.js
│   └── panel-injector.js
├── panel/
│   ├── panel.html
│   ├── panel.css
│   ├── panel.js
│   └── state.js
├── zotero/
│   ├── adapter.js
│   ├── connector-manual.js
│   └── connector-auto.js
└── docs/
    └── integration-notes.md
```

## 4) Key Data Models

Keep explicit schemas so UI, collector, and queue behavior stay predictable.

```ts
type SelectorRule = {
  id: string;
  name: string;
  cssSelector: string;      // e.g. ".results a.title[href]"
  urlAttribute: string;     // usually "href"
  includePattern?: string;  // optional regex string
  excludePattern?: string;  // optional regex string
  enabled: boolean;
};

type LinkCandidate = {
  id: string;               // hash(url + sourceSelector)
  url: string;
  title: string;
  sourceSelectorId: string;
  sourcePageUrl: string;
  selected: boolean;
  dedupeKey: string;        // normalized URL
};

type ArchiveQueueItem = {
  id: string;
  url: string;
  title: string;
  zoteroCollectionKey?: string;
  status: "pending" | "opening" | "awaiting_zotero" | "archived" | "failed" | "skipped";
  error?: string;
  attempts: number;
  createdAt: number;
  updatedAt: number;
};
```

## 5) Message Flow

Use strict action names and payload schemas between `content`, `panel`, and `background`.

1. Collection flow
   - `panel -> content`: `COLLECT_LINKS_REQUEST` (rules)
   - `content -> panel`: `COLLECT_LINKS_RESULT` (candidates, stats)
   - `panel -> background`: `UPSERT_CANDIDATES` (optional persistent cache)

2. Queue flow
   - `panel -> background`: `QUEUE_SET_ITEMS` (selected candidates)
   - `panel -> background`: `QUEUE_START`
   - `background -> panel` (broadcast via storage/message): `QUEUE_PROGRESS_UPDATE`
   - `panel -> background`: `QUEUE_PAUSE` / `QUEUE_RESUME` / `QUEUE_CANCEL`

3. Zotero flow
   - `background -> zotero adapter`: `archive(tabId, item, targetCollection)`
   - `zotero adapter -> background`: `{ok, status, error}`

## 6) Zotero Integration Boundary (TBD-safe)

Because Zotero Connector internals and automation hooks are still TBD, isolate this risk behind one interface.

```ts
interface ZoteroArchiveAdapter {
  initialize(): Promise<void>;
  archiveFromTab(input: {
    tabId: number;
    url: string;
    title?: string;
    collectionKey?: string;
  }): Promise<{ ok: boolean; mode: "manual" | "auto"; error?: string }>;
}
```

Initial strategy:

1. Ship MVP with `manual-confirm` mode.
   - Queue opens tab.
   - Panel prompts user to click Zotero save for that tab/collection.
   - User confirms success or failure to advance queue.

2. Add `automation` mode only after validating a reliable trigger path.
   - Keep feature-flagged.
   - Fall back to manual mode per item if automation fails.

## 7) Storage Plan

`chrome.storage.local` keys:

1. `panel.widthPx` (number, with min/max clamp)
2. `selectorRules` (`SelectorRule[]`)
3. `lastCollectedByPage` (map page URL -> `LinkCandidate[]`, bounded size)
4. `archiveQueue` (`ArchiveQueueItem[]`)
5. `queueRuntime` (running/paused/current item index)
6. `zoteroSettings` (preferred collection key, adapter mode, retry limits)

## 8) Permissions (Expected)

In `manifest.json`:

1. `permissions`: `storage`, `tabs`, `scripting`, `activeTab`
2. `host_permissions`: `<all_urls>` (or tighter list if scope is known)
3. `content_scripts`: host/panel bootstrap
4. `web_accessible_resources`: panel assets

## 9) Implementation Plan

### Phase 1: Scaffold + Panel Shell

1. Create MV3 manifest and baseline folders.
2. Implement content-script panel injection with:
   - Close/open behavior.
   - Drag-resize handle.
   - Width persistence and restore.
3. Deliverable: panel appears on any page and width is remembered.

### Phase 2: Selector-Based Collection

1. Build selector rule editor in panel (add/edit/remove/enable).
2. Implement DOM collection engine in content script:
   - Apply each enabled selector.
   - Resolve relative URLs to absolute.
   - Validate protocol and dedupe.
3. Deliverable: panel shows collected links with source selector and count metrics.

### Phase 3: Selection UX + Queue Authoring

1. Add link table/list with:
   - Row checkbox.
   - Select all / clear all / invert selection.
   - Filtering/search.
2. Convert selected links into `ArchiveQueueItem`s.
3. Deliverable: user can curate exactly which links enter queue.

### Phase 4: Queue Orchestrator

1. Implement background queue state machine:
   - `pending -> opening -> awaiting_zotero -> archived|failed`
2. Add controls: start, pause, resume, cancel, retry failed.
3. Persist queue and recover after extension restart.
4. Deliverable: deterministic queue processing and progress updates.

### Phase 5: Zotero Adapter MVP

1. Implement `connector-manual` adapter first.
2. Add collection target selection UI placeholder (if collection API unavailable, support manual collection selection in Zotero popup and user confirmation).
3. Hook adapter results into queue transitions.
4. Deliverable: end-to-end archival loop works with user confirmation per item.

### Phase 6: Hardening + Optional Automation

1. Instrument failure reasons and retry policy.
2. Add optional `connector-auto` adapter behind feature flag.
3. Add integration tests for queue transitions and DOM collection.
4. Deliverable: stable MVP plus experimental automation path.

## 10) Quality and Testing Strategy

1. Unit tests:
   - URL normalization and dedupe.
   - Selector rule filtering.
   - Queue transition reducer/state machine.
2. Manual test matrix:
   - Single-page apps with dynamic DOM updates.
   - Sites with relative links and base tags.
   - Tab failures/timeouts/network errors.
   - Browser restart during active queue.
3. Acceptance criteria:
   - No duplicate queue items for same normalized URL unless user explicitly allows.
   - Width preference persists across reloads.
   - Pause/resume never loses item state.
   - Failed item surfaces actionable error text.

## 11) Open Questions (Need Decision)

1. Zotero archive success detection:
   - Can we reliably detect Connector completion event?
   - If not, should manual confirm remain default?
2. Collection targeting:
   - Can collection key be set programmatically through Connector?
   - If not, should we support only default collection in MVP?
3. Queue parallelism:
   - Keep sequential only for predictable Zotero behavior, or allow low concurrency?
4. Scope of host permissions:
   - `<all_urls>` for flexibility now, or constrained domain allowlist?

## 12) MVP Recommendation

Ship a reliable first cut with:

1. Resizable in-page side panel.
2. Selector-driven link collection and curation.
3. Sequential queue execution.
4. Zotero manual-confirm adapter.

Then add automation only after Zotero connector behavior is validated in `docs/integration-notes.md`.
