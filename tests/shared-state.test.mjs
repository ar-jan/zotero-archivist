import test from "node:test";
import assert from "node:assert/strict";

import { routeMessage } from "../background/message-router.js";
import {
  QUEUE_ZOTERO_SAVE_MODES,
  clearQueueRuntimeActive,
  createDefaultQueueRuntimeState,
  getQueueItemCounts,
  markQueueItemFailed,
  normalizeCollectorSettings,
  normalizeCollectedLinks,
  normalizeQueueItems,
  normalizeQueueSettings,
  normalizeQueueRuntime
} from "../shared/state.js";

test("normalizeCollectedLinks keeps only unique valid http(s) links", () => {
  const links = normalizeCollectedLinks([
    { id: "a", url: "https://example.com/a", title: "A" },
    { id: "a2", url: "https://example.com/a" },
    { id: "b", url: "http://example.com/b", selected: false },
    { id: "c", url: "mailto:test@example.com" },
    { id: "d", url: "not a url" }
  ]);

  assert.equal(links.length, 2);
  assert.equal(links[0].url, "https://example.com/a");
  assert.equal(links[1].url, "http://example.com/b");
  assert.equal(links[1].selected, false);
});

test("normalizeCollectorSettings applies defaults and clamps bounds", () => {
  const defaults = normalizeCollectorSettings(null);
  assert.equal(defaults.maxLinksPerRun, 500);
  assert.equal(defaults.autoScrollEnabled, true);
  assert.equal(defaults.autoScrollMaxRounds, 30);
  assert.equal(defaults.autoScrollIdleRounds, 3);
  assert.equal(defaults.autoScrollSettleDelayMs, 750);

  const clampedLow = normalizeCollectorSettings({
    maxLinksPerRun: 0,
    autoScrollEnabled: false,
    autoScrollMaxRounds: 0,
    autoScrollIdleRounds: 0,
    autoScrollSettleDelayMs: 0
  });
  assert.equal(clampedLow.maxLinksPerRun, 1);
  assert.equal(clampedLow.autoScrollEnabled, false);
  assert.equal(clampedLow.autoScrollMaxRounds, 1);
  assert.equal(clampedLow.autoScrollIdleRounds, 1);
  assert.equal(clampedLow.autoScrollSettleDelayMs, 100);

  const clampedHigh = normalizeCollectorSettings({
    maxLinksPerRun: 99999,
    autoScrollMaxRounds: 99999,
    autoScrollIdleRounds: 99999,
    autoScrollSettleDelayMs: 99999
  });
  assert.equal(clampedHigh.maxLinksPerRun, 5000);
  assert.equal(clampedHigh.autoScrollMaxRounds, 200);
  assert.equal(clampedHigh.autoScrollIdleRounds, 20);
  assert.equal(clampedHigh.autoScrollSettleDelayMs, 10000);
});

test("normalizeQueueSettings applies defaults and clamps delay bounds", () => {
  const defaults = normalizeQueueSettings(null);
  assert.equal(defaults.interItemDelayMs, 5000);
  assert.equal(defaults.interItemDelayJitterMs, 2000);
  assert.equal(defaults.zoteroSaveMode, QUEUE_ZOTERO_SAVE_MODES.WEBPAGE_WITH_SNAPSHOT);

  const clampedLow = normalizeQueueSettings({
    interItemDelayMs: -100,
    interItemDelayJitterMs: -20
  });
  assert.equal(clampedLow.interItemDelayMs, 0);
  assert.equal(clampedLow.interItemDelayJitterMs, 0);

  const clampedHigh = normalizeQueueSettings({
    interItemDelayMs: 999999,
    interItemDelayJitterMs: 999999,
    zoteroSaveMode: "invalid"
  });
  assert.equal(clampedHigh.interItemDelayMs, 600000);
  assert.equal(clampedHigh.interItemDelayJitterMs, 60000);
  assert.equal(clampedHigh.zoteroSaveMode, QUEUE_ZOTERO_SAVE_MODES.WEBPAGE_WITH_SNAPSHOT);

  const embeddedMetadata = normalizeQueueSettings({
    zoteroSaveMode: QUEUE_ZOTERO_SAVE_MODES.EMBEDDED_METADATA
  });
  assert.equal(embeddedMetadata.zoteroSaveMode, QUEUE_ZOTERO_SAVE_MODES.EMBEDDED_METADATA);
});

test("normalizeQueueItems normalizes status and dedupes urls", () => {
  const queueItems = normalizeQueueItems([
    { id: "q1", url: "https://example.com/x", status: "archived", attempts: 2 },
    { id: "q2", url: "https://example.com/x", status: "failed", attempts: 1 },
    { id: "q3", url: "https://example.com/y", status: "not-real", attempts: -1 }
  ]);

  assert.equal(queueItems.length, 2);
  assert.equal(queueItems[0].status, "archived");
  assert.equal(queueItems[1].status, "pending");
  assert.equal(queueItems[1].attempts, 0);
});

test("normalizeQueueRuntime clears invalid active context", () => {
  const idle = normalizeQueueRuntime({
    status: "idle",
    activeQueueItemId: "x",
    activeTabId: 123,
    controllerWindowId: 9,
    updatedAt: 1
  });
  assert.equal(idle.status, "idle");
  assert.equal(idle.activeQueueItemId, null);
  assert.equal(idle.activeTabId, null);
  assert.equal(idle.controllerWindowId, null);
  assert.equal(idle.nextRunAt, null);

  const invalidRunning = normalizeQueueRuntime({
    status: "running",
    activeQueueItemId: "x",
    activeTabId: null,
    controllerWindowId: 45,
    nextRunAt: 1234
  });
  assert.equal(invalidRunning.status, "running");
  assert.equal(invalidRunning.activeQueueItemId, null);
  assert.equal(invalidRunning.activeTabId, null);
  assert.equal(invalidRunning.controllerWindowId, 45);
  assert.equal(invalidRunning.nextRunAt, 1234);
});

test("queue helper functions expose expected transitions", () => {
  const now = Date.now();
  const defaultRuntime = createDefaultQueueRuntimeState(now);
  assert.equal(defaultRuntime.status, "idle");
  assert.equal(defaultRuntime.controllerWindowId, null);
  assert.equal(defaultRuntime.nextRunAt, null);

  const activeCleared = clearQueueRuntimeActive({
    status: "running",
    activeQueueItemId: "q1",
    activeTabId: 12,
    controllerWindowId: 12,
    nextRunAt: 99,
    updatedAt: now
  });
  assert.equal(activeCleared.activeQueueItemId, null);
  assert.equal(activeCleared.activeTabId, null);
  assert.equal(activeCleared.controllerWindowId, 12);
  assert.equal(activeCleared.nextRunAt, null);

  const failed = markQueueItemFailed(
    {
      id: "q1",
      url: "https://example.com",
      title: "Example",
      status: "saving_snapshot",
      attempts: 1,
      createdAt: now,
      updatedAt: now
    },
    "boom"
  );
  assert.equal(failed.status, "failed");
  assert.equal(failed.lastError, "boom");
});

test("getQueueItemCounts aggregates queue state", () => {
  const counts = getQueueItemCounts([
    { status: "pending" },
    { status: "archived" },
    { status: "failed" },
    { status: "cancelled" }
  ]);

  assert.deepEqual(counts, {
    pendingCount: 1,
    archivedCount: 1,
    failedCount: 1,
    cancelledCount: 1,
    retriableCount: 2
  });
});

test("routeMessage validates payload and dispatches handlers", async () => {
  const invalid = await routeMessage(null, {});
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, "BAD_REQUEST");

  const unsupported = await routeMessage({ type: "MISSING" }, {});
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.error.code, "BAD_REQUEST");

  const ok = await routeMessage(
    { type: "PING" },
    {
      PING: async () => ({ ok: true, pong: true })
    }
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.pong, true);
});
