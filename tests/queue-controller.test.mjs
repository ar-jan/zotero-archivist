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
  initialQueueItems = [{ id: "q1", status: "pending", attempts: 0 }],
  queueLifecycleActionImpl = async () => ({ ok: true, queueItems: [], queueRuntime: { status: "idle" } }),
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
  let queueActionStateUpdates = 0;

  let collectedLinks = initialCollectedLinks;
  let queueItems = initialQueueItems;

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
    queueLifecycleActionImpl,
    authorQueueFromSelectionActionImpl,
    clearQueueActionImpl,
    setQueueItemsState(value) {
      queueItems = value;
      queueItemsWrites.push(value);
    },
    setQueueRuntimeState(value) {
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
    get queueActionStateUpdates() {
      return queueActionStateUpdates;
    }
  };
}
