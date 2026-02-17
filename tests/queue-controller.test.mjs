import test from "node:test";
import assert from "node:assert/strict";

import { MESSAGE_TYPES } from "../shared/protocol.js";
import { createQueueController } from "../sidepanel/queue-controller.js";

test("queue controller starts queue and updates lifecycle status", async () => {
  const seenMessageTypes = [];
  const harness = createHarness({
    queueLifecycleActionImpl: async (messageType) => {
      seenMessageTypes.push(messageType);
      return {
        ok: true,
        queueItems: [{ id: "q1", status: "pending", attempts: 0 }],
        queueRuntime: { status: "running", activeQueueItemId: "q1" }
      };
    }
  });

  await harness.controller.startQueueProcessing();

  assert.deepEqual(seenMessageTypes, [MESSAGE_TYPES.START_QUEUE]);
  assert.deepEqual(harness.permissionRequests, [["https://example.com/q1"]]);
  assert.equal(harness.statuses.at(-1), "Queue started.");
  assert.deepEqual(harness.lifecycleBusyChanges, [true, false]);
  assert.equal(harness.queueActionStateUpdates >= 2, true);
  assert.equal(harness.queueItemsWrites.length, 1);
  assert.equal(harness.queueRuntimeWrites.length, 1);
});

test("queue controller retry status shows retried count", async () => {
  const harness = createHarness({
    queueLifecycleActionImpl: async () => ({
      ok: true,
      queueItems: [],
      queueRuntime: { status: "idle", activeQueueItemId: null },
      retriedCount: 2
    })
  });

  await harness.controller.retryFailedQueueItems();

  assert.equal(harness.statuses.at(-1), "Queued 2 item(s) for retry.");
});

test("queue controller reverses queue order and reports lifecycle status", async () => {
  const seenMessageTypes = [];
  const harness = createHarness({
    initialQueueItems: [
      { id: "q1", url: "https://example.com/q1", status: "pending", attempts: 0 },
      { id: "q2", url: "https://example.com/q2", status: "failed", attempts: 1 }
    ],
    queueLifecycleActionImpl: async (messageType) => {
      seenMessageTypes.push(messageType);
      return {
        ok: true,
        queueItems: [
          { id: "q2", url: "https://example.com/q2", status: "failed", attempts: 1 },
          { id: "q1", url: "https://example.com/q1", status: "pending", attempts: 0 }
        ],
        queueRuntime: { status: "idle", activeQueueItemId: null, activeTabId: null }
      };
    }
  });

  await harness.controller.reverseQueueItems();

  assert.deepEqual(seenMessageTypes, [MESSAGE_TYPES.REVERSE_QUEUE]);
  assert.equal(harness.permissionRequests.length, 0);
  assert.equal(harness.statuses.at(-1), "Queue order reversed.");
  assert.deepEqual(harness.lifecycleBusyChanges, [true, false]);
  assert.equal(harness.queueActionStateUpdates >= 2, true);
  assert.equal(harness.queueItemsWrites.length, 1);
  assert.equal(harness.queueRuntimeWrites.length, 1);
});

test("queue controller blocks start when queue host permission preflight is denied", async () => {
  const seenMessageTypes = [];
  const harness = createHarness({
    ensureHostPermissionsForUrlsActionImpl: async () => ({
      granted: false,
      requestedOrigins: ["https://example.com/*"]
    }),
    queueLifecycleActionImpl: async (messageType) => {
      seenMessageTypes.push(messageType);
      return {
        ok: true,
        queueItems: [],
        queueRuntime: { status: "running", activeQueueItemId: null }
      };
    }
  });

  await harness.controller.startQueueProcessing();

  assert.deepEqual(seenMessageTypes, []);
  assert.equal(harness.statuses.at(-1), "Permission was not granted for the queued site.");
});

test("queue controller preflights resume with pending and active item urls", async () => {
  const seenMessageTypes = [];
  const harness = createHarness({
    initialQueueRuntime: {
      status: "paused",
      activeQueueItemId: "q-active"
    },
    initialQueueItems: [
      {
        id: "q-active",
        url: "https://example.com/active",
        status: "saving_snapshot",
        attempts: 1
      },
      {
        id: "q-pending",
        url: "https://example.com/pending",
        status: "pending",
        attempts: 0
      }
    ],
    queueLifecycleActionImpl: async (messageType) => {
      seenMessageTypes.push(messageType);
      return {
        ok: true,
        queueItems: [],
        queueRuntime: { status: "running", activeQueueItemId: "q-active" }
      };
    }
  });

  await harness.controller.resumeQueueProcessing();

  assert.deepEqual(seenMessageTypes, [MESSAGE_TYPES.RESUME_QUEUE]);
  assert.equal(harness.permissionRequests.length, 1);
  assert.deepEqual(harness.permissionRequests[0], [
    "https://example.com/pending",
    "https://example.com/active"
  ]);
});

test("queue controller rejects queue authoring when nothing is selected", async () => {
  const harness = createHarness({
    initialCollectedLinks: [
      { id: "l1", url: "https://example.com/1", title: "One", selected: false }
    ]
  });

  await harness.controller.addSelectedLinksToQueue();

  assert.equal(harness.statuses.at(-1), "Select at least one link to add to queue.");
});

test("queue controller reports already-queued selection", async () => {
  const harness = createHarness({
    initialCollectedLinks: [{ id: "l1", url: "https://example.com/1", title: "One", selected: true }],
    authorQueueFromSelectionActionImpl: async () => ({
      ok: true,
      queueItems: [{ id: "q1", status: "pending", attempts: 0 }],
      addedCount: 0,
      skippedCount: 1
    })
  });

  await harness.controller.addSelectedLinksToQueue();

  assert.equal(harness.statuses.at(-1), "Selected links are already in queue.");
});

test("queue controller no-ops clear when queue is already empty", async () => {
  const harness = createHarness({
    initialQueueItems: []
  });

  await harness.controller.clearQueueItems();

  assert.equal(harness.statuses.at(-1), "Queue is already empty.");
});

test("queue controller surfaces clear-queue error message", async () => {
  const harness = createHarness({
    initialQueueItems: [{ id: "q1", status: "pending", attempts: 0 }],
    clearQueueActionImpl: async () => ({
      ok: false,
      error: { message: "storage write failed" }
    })
  });

  await harness.controller.clearQueueItems();

  assert.equal(harness.statuses.at(-1), "storage write failed");
});

function createHarness({
  initialCollectedLinks = [{ id: "l1", url: "https://example.com", title: "Example", selected: true }],
  initialQueueItems = [{ id: "q1", url: "https://example.com/q1", status: "pending", attempts: 0 }],
  initialQueueRuntime = { status: "idle", activeQueueItemId: null, activeTabId: null },
  queueLifecycleActionImpl = async () => ({ ok: true, queueItems: [], queueRuntime: { status: "idle" } }),
  ensureHostPermissionsForUrlsActionImpl = async () => ({
    granted: true,
    requestedOrigins: []
  }),
  authorQueueFromSelectionActionImpl = async () => ({
    ok: true,
    queueItems: [{ id: "q1", status: "pending", attempts: 0 }],
    addedCount: 1,
    skippedCount: 0
  }),
  clearQueueActionImpl = async () => ({ ok: true, queueItems: [], queueRuntime: { status: "idle" } })
} = {}) {
  const statuses = [];
  const lifecycleBusyChanges = [];
  const authoringBusyChanges = [];
  const clearingBusyChanges = [];
  const queueItemsWrites = [];
  const queueRuntimeWrites = [];
  const permissionRequests = [];
  let queueActionStateUpdates = 0;

  let collectedLinks = initialCollectedLinks;
  let queueItems = initialQueueItems;
  let queueRuntime = initialQueueRuntime;

  const panelStore = {
    setQueueLifecycleInProgress(value) {
      lifecycleBusyChanges.push(Boolean(value));
    },
    setQueueAuthoringInProgress(value) {
      authoringBusyChanges.push(Boolean(value));
    },
    setQueueClearingInProgress(value) {
      clearingBusyChanges.push(Boolean(value));
    }
  };

  const controller = createQueueController({
    panelStore,
    getCollectedLinks: () => collectedLinks,
    getQueueItems: () => queueItems,
    getQueueRuntime: () => queueRuntime,
    queueLifecycleActionImpl,
    ensureHostPermissionsForUrlsActionImpl: async (urls) => {
      permissionRequests.push([...urls]);
      return ensureHostPermissionsForUrlsActionImpl(urls);
    },
    authorQueueFromSelectionActionImpl,
    clearQueueActionImpl,
    setQueueItemsState(value) {
      queueItems = value;
      queueItemsWrites.push(value);
    },
    setQueueRuntimeState(value) {
      queueRuntime = value;
      queueRuntimeWrites.push(value);
    },
    updateQueueActionState() {
      queueActionStateUpdates += 1;
    },
    setStatus(value) {
      statuses.push(value);
    },
    messageFromError(error) {
      return typeof error?.message === "string" ? error.message : null;
    },
    logger: {
      error() {}
    }
  });

  return {
    controller,
    statuses,
    lifecycleBusyChanges,
    authoringBusyChanges,
    clearingBusyChanges,
    queueItemsWrites,
    queueRuntimeWrites,
    permissionRequests,
    get queueActionStateUpdates() {
      return queueActionStateUpdates;
    }
  };
}
