import test from "node:test";
import assert from "node:assert/strict";

import { routeMessage } from "../background/message-router.js";
import {
  clearQueueRuntimeActive,
  createDefaultQueueRuntimeState,
  getQueueItemCounts,
  markQueueItemFailed,
  normalizeCollectedLinks,
  normalizeQueueItems,
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
    updatedAt: 1
  });
  assert.equal(idle.status, "idle");
  assert.equal(idle.activeQueueItemId, null);
  assert.equal(idle.activeTabId, null);

  const invalidRunning = normalizeQueueRuntime({
    status: "running",
    activeQueueItemId: "x",
    activeTabId: null
  });
  assert.equal(invalidRunning.status, "running");
  assert.equal(invalidRunning.activeQueueItemId, null);
  assert.equal(invalidRunning.activeTabId, null);
});

test("queue helper functions expose expected transitions", () => {
  const now = Date.now();
  const defaultRuntime = createDefaultQueueRuntimeState(now);
  assert.equal(defaultRuntime.status, "idle");

  const activeCleared = clearQueueRuntimeActive({
    status: "running",
    activeQueueItemId: "q1",
    activeTabId: 12,
    updatedAt: now
  });
  assert.equal(activeCleared.activeQueueItemId, null);
  assert.equal(activeCleared.activeTabId, null);

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
