import test from "node:test";
import assert from "node:assert/strict";

import { createQueueLifecycleHandlers } from "../background/queue-lifecycle.js";

test("startQueue starts running queue when pending items exist", async () => {
  const harness = createHarness({
    queueRuntime: createQueueRuntime({ status: "idle" }),
    queueItems: [createQueueItem({ id: "q1", status: "pending" })]
  });

  const response = await harness.handlers.startQueue({
    controllerWindowId: 12
  });

  assert.equal(response.ok, true);
  assert.equal(response.pendingCount, 1);
  assert.equal(response.queueRuntime.status, "running");
  assert.equal(response.queueRuntime.controllerWindowId, 12);
  assert.deepEqual(harness.calls.runQueueEngineSoon, ["start"]);
  assert.equal(harness.state.queueRuntime.status, "running");
  assert.equal(harness.state.queueRuntime.controllerWindowId, 12);
});

test("startQueue reports alreadyRunning when queue is already running", async () => {
  const harness = createHarness({
    queueRuntime: createQueueRuntime({ status: "running" }),
    queueItems: [createQueueItem({ id: "q1", status: "pending" })]
  });

  const response = await harness.handlers.startQueue();

  assert.equal(response.ok, true);
  assert.equal(response.alreadyRunning, true);
  assert.deepEqual(harness.calls.runQueueEngineSoon, ["start-already-running"]);
});

test("startQueue clears stale delay when already running without active item", async () => {
  const harness = createHarness({
    queueRuntime: createQueueRuntime({
      status: "running",
      nextRunAt: Date.now() + 60000,
      activeQueueItemId: null,
      activeTabId: null
    }),
    queueItems: [createQueueItem({ id: "q1", status: "pending" })]
  });

  const response = await harness.handlers.startQueue();

  assert.equal(response.ok, true);
  assert.equal(response.queueRuntime.nextRunAt, null);
  assert.equal(harness.state.queueRuntime.nextRunAt, null);
  assert.deepEqual(harness.calls.runQueueEngineSoon, ["start-already-running"]);
});

test("startQueue rejects when queue is paused or has no pending items", async () => {
  const pausedHarness = createHarness({
    queueRuntime: createQueueRuntime({ status: "paused" }),
    queueItems: [createQueueItem({ id: "q1", status: "pending" })]
  });
  const pausedResponse = await pausedHarness.handlers.startQueue();
  assert.equal(pausedResponse.ok, false);
  assert.equal(pausedResponse.error.code, "BAD_REQUEST");

  const noPendingHarness = createHarness({
    queueRuntime: createQueueRuntime({ status: "idle" }),
    queueItems: [createQueueItem({ id: "q2", status: "archived" })]
  });
  const noPendingResponse = await noPendingHarness.handlers.startQueue();
  assert.equal(noPendingResponse.ok, false);
  assert.equal(noPendingResponse.error.code, "BAD_REQUEST");
});

test("pauseQueue moves runtime to paused and clears queue alarm", async () => {
  const harness = createHarness({
    queueRuntime: createQueueRuntime({ status: "running" }),
    queueItems: [createQueueItem({ id: "q1", status: "pending" })]
  });

  const response = await harness.handlers.pauseQueue();

  assert.equal(response.ok, true);
  assert.equal(response.queueRuntime.status, "paused");
  assert.equal(harness.calls.clearQueueAlarm, 1);
  assert.equal(harness.state.queueRuntime.status, "paused");
});

test("pauseQueue rejects when runtime is not running", async () => {
  const harness = createHarness({
    queueRuntime: createQueueRuntime({ status: "idle" })
  });

  const response = await harness.handlers.pauseQueue();

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "BAD_REQUEST");
  assert.equal(harness.calls.clearQueueAlarm, 0);
});

test("resumeQueue restarts paused runtime with pending work", async () => {
  const harness = createHarness({
    queueRuntime: createQueueRuntime({ status: "paused" }),
    queueItems: [createQueueItem({ id: "q1", status: "pending" })]
  });

  const response = await harness.handlers.resumeQueue({
    controllerWindowId: 22
  });

  assert.equal(response.ok, true);
  assert.equal(response.queueRuntime.status, "running");
  assert.equal(response.queueRuntime.controllerWindowId, 22);
  assert.deepEqual(harness.calls.runQueueEngineSoon, ["resume"]);
  assert.equal(harness.state.queueRuntime.status, "running");
  assert.equal(harness.state.queueRuntime.controllerWindowId, 22);
});

test("resumeQueue keeps persisted controller window id when no context is supplied", async () => {
  const harness = createHarness({
    queueRuntime: createQueueRuntime({
      status: "paused",
      controllerWindowId: 55
    }),
    queueItems: [createQueueItem({ id: "q1", status: "pending" })]
  });

  const response = await harness.handlers.resumeQueue();

  assert.equal(response.ok, true);
  assert.equal(response.queueRuntime.controllerWindowId, 55);
  assert.equal(harness.state.queueRuntime.controllerWindowId, 55);
});

test("resumeQueue rejects invalid states and empty paused queue", async () => {
  const idleHarness = createHarness({
    queueRuntime: createQueueRuntime({ status: "idle" }),
    queueItems: [createQueueItem({ id: "q1", status: "pending" })]
  });
  const idleResponse = await idleHarness.handlers.resumeQueue();
  assert.equal(idleResponse.ok, false);
  assert.equal(idleResponse.error.code, "BAD_REQUEST");

  const emptyPausedHarness = createHarness({
    queueRuntime: createQueueRuntime({ status: "paused" }),
    queueItems: [createQueueItem({ id: "q2", status: "archived" })]
  });
  const emptyPausedResponse = await emptyPausedHarness.handlers.resumeQueue();
  assert.equal(emptyPausedResponse.ok, false);
  assert.equal(emptyPausedResponse.error.code, "BAD_REQUEST");
});

test("stopQueue cancels active item, resets runtime, clears alarm and closes tab", async () => {
  const harness = createHarness({
    queueRuntime: createQueueRuntime({
      status: "running",
      activeQueueItemId: "q1",
      activeTabId: 77
    }),
    queueItems: [
      createQueueItem({ id: "q1", status: "saving_snapshot" }),
      createQueueItem({ id: "q2", status: "pending" })
    ]
  });

  const response = await harness.handlers.stopQueue();

  assert.equal(response.ok, true);
  assert.equal(response.queueRuntime.status, "idle");
  assert.equal(response.queueItems[0].status, "cancelled");
  assert.equal(response.queueItems[0].lastError, "Queue was stopped before completion.");
  assert.equal(harness.calls.clearQueueAlarm, 1);
  assert.deepEqual(harness.calls.closeTabIfPresent, [77]);
  assert.equal(harness.state.queueRuntime.status, "idle");
});

test("retryFailedQueue resets failed/cancelled items to pending", async () => {
  const harness = createHarness({
    queueRuntime: createQueueRuntime({ status: "idle" }),
    queueItems: [
      createQueueItem({ id: "q1", status: "failed", lastError: "err-1" }),
      createQueueItem({ id: "q2", status: "cancelled", lastError: "err-2" }),
      createQueueItem({ id: "q3", status: "archived" })
    ]
  });

  const response = await harness.handlers.retryFailedQueue();

  assert.equal(response.ok, true);
  assert.equal(response.retriedCount, 2);
  assert.equal(response.queueItems[0].status, "pending");
  assert.equal(response.queueItems[0].lastError, undefined);
  assert.equal(response.queueItems[1].status, "pending");
  assert.equal(response.queueItems[1].lastError, undefined);
});

test("retryFailedQueue rejects when running or nothing retriable", async () => {
  const runningHarness = createHarness({
    queueRuntime: createQueueRuntime({ status: "running" }),
    queueItems: [createQueueItem({ id: "q1", status: "failed" })]
  });
  const runningResponse = await runningHarness.handlers.retryFailedQueue();
  assert.equal(runningResponse.ok, false);
  assert.equal(runningResponse.error.code, "BAD_REQUEST");

  const noneHarness = createHarness({
    queueRuntime: createQueueRuntime({ status: "idle" }),
    queueItems: [createQueueItem({ id: "q2", status: "archived" })]
  });
  const noneResponse = await noneHarness.handlers.retryFailedQueue();
  assert.equal(noneResponse.ok, false);
  assert.equal(noneResponse.error.code, "BAD_REQUEST");
});

test("clearArchivedQueue removes archived items when queue is not running", async () => {
  const harness = createHarness({
    queueRuntime: createQueueRuntime({ status: "paused" }),
    queueItems: [
      createQueueItem({ id: "q1", status: "pending" }),
      createQueueItem({ id: "q2", status: "archived" }),
      createQueueItem({ id: "q3", status: "failed", lastError: "save failed" }),
      createQueueItem({ id: "q4", status: "archived" })
    ]
  });

  const response = await harness.handlers.clearArchivedQueue();

  assert.equal(response.ok, true);
  assert.equal(response.clearedCount, 2);
  assert.deepEqual(response.queueItems.map((item) => item.id), ["q1", "q3"]);
  assert.deepEqual(harness.state.queueItems.map((item) => item.id), ["q1", "q3"]);
  assert.equal(response.queueRuntime.status, "paused");
});

test("clearArchivedQueue rejects when running or when queue has no archived items", async () => {
  const runningHarness = createHarness({
    queueRuntime: createQueueRuntime({ status: "running" }),
    queueItems: [createQueueItem({ id: "q1", status: "archived" })]
  });

  const runningResponse = await runningHarness.handlers.clearArchivedQueue();
  assert.equal(runningResponse.ok, false);
  assert.equal(runningResponse.error.code, "BAD_REQUEST");

  const noneHarness = createHarness({
    queueRuntime: createQueueRuntime({ status: "idle" }),
    queueItems: [createQueueItem({ id: "q2", status: "pending" })]
  });

  const noneResponse = await noneHarness.handlers.clearArchivedQueue();
  assert.equal(noneResponse.ok, false);
  assert.equal(noneResponse.error.code, "BAD_REQUEST");
});

test("removeQueueItem removes a non-active queue item when queue is not running", async () => {
  const harness = createHarness({
    queueRuntime: createQueueRuntime({ status: "idle" }),
    queueItems: [
      createQueueItem({ id: "q1", status: "pending" }),
      createQueueItem({ id: "q2", status: "failed", lastError: "save failed" })
    ]
  });

  const response = await harness.handlers.removeQueueItem({
    id: "q2"
  });

  assert.equal(response.ok, true);
  assert.equal(response.removedCount, 1);
  assert.deepEqual(response.queueItems.map((item) => item.id), ["q1"]);
  assert.deepEqual(harness.state.queueItems.map((item) => item.id), ["q1"]);
  assert.equal(response.queueRuntime.status, "idle");
  assert.deepEqual(harness.calls.closeTabIfPresent, []);
});

test("removeQueueItem clears active runtime state when removing paused active item", async () => {
  const harness = createHarness({
    queueRuntime: createQueueRuntime({
      status: "paused",
      activeQueueItemId: "q2",
      activeTabId: 77
    }),
    queueItems: [
      createQueueItem({ id: "q1", status: "pending" }),
      createQueueItem({ id: "q2", status: "saving_snapshot", attempts: 1 })
    ]
  });

  const response = await harness.handlers.removeQueueItem({
    id: "q2"
  });

  assert.equal(response.ok, true);
  assert.equal(response.queueRuntime.status, "paused");
  assert.equal(response.queueRuntime.activeQueueItemId, null);
  assert.equal(response.queueRuntime.activeTabId, null);
  assert.deepEqual(harness.calls.closeTabIfPresent, [77]);
});

test("removeQueueItem rejects running queue, missing ids, and unknown items", async () => {
  const runningHarness = createHarness({
    queueRuntime: createQueueRuntime({ status: "running" }),
    queueItems: [createQueueItem({ id: "q1", status: "pending" })]
  });
  const runningResponse = await runningHarness.handlers.removeQueueItem({
    id: "q1"
  });
  assert.equal(runningResponse.ok, false);
  assert.equal(runningResponse.error.code, "BAD_REQUEST");

  const invalidPayloadHarness = createHarness({
    queueRuntime: createQueueRuntime({ status: "idle" }),
    queueItems: [createQueueItem({ id: "q1", status: "pending" })]
  });
  const invalidPayloadResponse = await invalidPayloadHarness.handlers.removeQueueItem({
    id: "   "
  });
  assert.equal(invalidPayloadResponse.ok, false);
  assert.equal(invalidPayloadResponse.error.code, "BAD_REQUEST");

  const unknownItemHarness = createHarness({
    queueRuntime: createQueueRuntime({ status: "idle" }),
    queueItems: [createQueueItem({ id: "q1", status: "pending" })]
  });
  const unknownItemResponse = await unknownItemHarness.handlers.removeQueueItem({
    id: "q-missing"
  });
  assert.equal(unknownItemResponse.ok, false);
  assert.equal(unknownItemResponse.error.code, "QUEUE_ITEM_NOT_FOUND");
});

test("reverseQueue reverses queue item order when queue is not running", async () => {
  const harness = createHarness({
    queueRuntime: createQueueRuntime({
      status: "paused",
      activeQueueItemId: "q2",
      activeTabId: 77
    }),
    queueItems: [
      createQueueItem({ id: "q1", status: "pending" }),
      createQueueItem({ id: "q2", status: "saving_snapshot" }),
      createQueueItem({ id: "q3", status: "failed", lastError: "save failed" })
    ]
  });

  const response = await harness.handlers.reverseQueue();

  assert.equal(response.ok, true);
  assert.deepEqual(response.queueItems.map((item) => item.id), ["q3", "q2", "q1"]);
  assert.deepEqual(harness.state.queueItems.map((item) => item.id), ["q3", "q2", "q1"]);
  assert.equal(response.queueRuntime.status, "paused");
  assert.equal(response.queueRuntime.activeQueueItemId, "q2");
  assert.equal(response.queueRuntime.activeTabId, 77);
});

test("reverseQueue rejects when queue is running or has fewer than two items", async () => {
  const runningHarness = createHarness({
    queueRuntime: createQueueRuntime({ status: "running" }),
    queueItems: [
      createQueueItem({ id: "q1", status: "pending" }),
      createQueueItem({ id: "q2", status: "pending" })
    ]
  });

  const runningResponse = await runningHarness.handlers.reverseQueue();
  assert.equal(runningResponse.ok, false);
  assert.equal(runningResponse.error.code, "BAD_REQUEST");

  const tooShortHarness = createHarness({
    queueRuntime: createQueueRuntime({ status: "idle" }),
    queueItems: [createQueueItem({ id: "q1", status: "pending" })]
  });

  const tooShortResponse = await tooShortHarness.handlers.reverseQueue();
  assert.equal(tooShortResponse.ok, false);
  assert.equal(tooShortResponse.error.code, "BAD_REQUEST");
});

function createHarness({
  queueRuntime = createQueueRuntime(),
  queueItems = []
} = {}) {
  const state = {
    queueRuntime: { ...queueRuntime },
    queueItems: queueItems.map((item) => ({ ...item }))
  };

  const calls = {
    clearQueueAlarm: 0,
    closeTabIfPresent: [],
    runQueueEngineSoon: []
  };

  const queueEngine = {
    async clearQueueAlarm() {
      calls.clearQueueAlarm += 1;
    },
    async closeTabIfPresent(tabId) {
      calls.closeTabIfPresent.push(tabId);
    },
    runQueueEngineSoon(trigger) {
      calls.runQueueEngineSoon.push(trigger);
    }
  };

  const handlers = createQueueLifecycleHandlers({
    getQueueRuntime: async () => ({ ...state.queueRuntime }),
    saveQueueRuntime: async (queueRuntimeValue) => {
      state.queueRuntime = { ...queueRuntimeValue };
      return state.queueRuntime;
    },
    getQueueItems: async () => state.queueItems.map((item) => ({ ...item })),
    saveQueueItems: async (queueItemsValue) => {
      state.queueItems = queueItemsValue.map((item) => ({ ...item }));
      return state.queueItems;
    },
    queueEngine
  });

  return {
    calls,
    handlers,
    state
  };
}

function createQueueRuntime(overrides = {}) {
  return {
    status: "idle",
    activeQueueItemId: null,
    activeTabId: null,
    controllerWindowId: null,
    updatedAt: Date.now(),
    ...overrides
  };
}

function createQueueItem({ id, status = "pending", lastError = undefined }) {
  const queueItem = {
    id,
    url: `https://example.com/${id}`,
    title: id,
    status,
    attempts: 0,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  if (typeof lastError === "string") {
    queueItem.lastError = lastError;
  }
  return queueItem;
}
