import test from "node:test";
import assert from "node:assert/strict";

import { createQueueEngine, QUEUE_ENGINE_ALARM_NAME } from "../background/queue-engine.js";

test("runQueueEngineSoon opens a pending item tab and stores active runtime context", async (t) => {
  const chromeMock = installChromeMock();
  t.after(() => chromeMock.restore());

  const harness = createQueueEngineHarness({
    queueItems: [createQueueItem({ id: "q1", url: "https://example.com/a" })],
    queueRuntime: createQueueRuntime({ status: "running" })
  });

  await harness.queueEngine.runQueueEngineSoon("test-open");

  const { queueItems, queueRuntime } = harness.getState();
  assert.equal(queueItems[0].status, "opening_tab");
  assert.equal(queueItems[0].attempts, 1);
  assert.equal(queueRuntime.activeQueueItemId, "q1");
  assert.ok(Number.isInteger(queueRuntime.activeTabId));
  assert.deepEqual(chromeMock.alarms.created.map((entry) => entry.name), [QUEUE_ENGINE_ALARM_NAME]);
});

test("runQueueEngineSoon archives an active item when provider save succeeds", async (t) => {
  const chromeMock = installChromeMock({
    tabsById: new Map([
      [51, { id: 51, url: "https://example.com/a", status: "complete" }]
    ])
  });
  t.after(() => chromeMock.restore());

  const harness = createQueueEngineHarness({
    queueItems: [createQueueItem({ id: "q1", url: "https://example.com/a", status: "opening_tab" })],
    queueRuntime: createQueueRuntime({
      status: "running",
      activeQueueItemId: "q1",
      activeTabId: 51
    }),
    saveQueueItemWithProvider: async () => ({ ok: true })
  });

  await harness.queueEngine.runQueueEngineSoon("test-save-success");
  await harness.queueEngine.waitForIdle();

  const { queueItems, queueRuntime } = harness.getState();
  assert.equal(queueItems[0].status, "archived");
  assert.equal(queueRuntime.status, "idle");
  assert.equal(queueRuntime.activeQueueItemId, null);
  assert.equal(queueRuntime.activeTabId, null);
  assert.deepEqual(chromeMock.tabs.removed, [51]);
  assert.ok(chromeMock.alarms.cleared.includes(QUEUE_ENGINE_ALARM_NAME));
});

test("runQueueEngineSoon fails an active item when provider save fails", async (t) => {
  const chromeMock = installChromeMock({
    tabsById: new Map([
      [52, { id: 52, url: "https://example.com/a", status: "complete" }]
    ])
  });
  t.after(() => chromeMock.restore());

  const harness = createQueueEngineHarness({
    queueItems: [createQueueItem({ id: "q1", url: "https://example.com/a", status: "opening_tab" })],
    queueRuntime: createQueueRuntime({
      status: "running",
      activeQueueItemId: "q1",
      activeTabId: 52
    }),
    saveQueueItemWithProvider: async () => ({ ok: false, error: "Bridge save failed." })
  });

  await harness.queueEngine.runQueueEngineSoon("test-save-failed");
  await harness.queueEngine.waitForIdle();

  const { queueItems, queueRuntime } = harness.getState();
  assert.equal(queueItems[0].status, "failed");
  assert.equal(queueItems[0].lastError, "Bridge save failed.");
  assert.equal(queueRuntime.status, "idle");
  assert.deepEqual(chromeMock.tabs.removed, [52]);
});

test("handleQueueAlarm fails loading active item on watchdog timeout", async (t) => {
  const chromeMock = installChromeMock({
    tabsById: new Map([
      [53, { id: 53, url: "https://example.com/a", status: "loading" }]
    ])
  });
  t.after(() => chromeMock.restore());

  const harness = createQueueEngineHarness({
    queueItems: [createQueueItem({ id: "q1", url: "https://example.com/a", status: "opening_tab" })],
    queueRuntime: createQueueRuntime({
      status: "running",
      activeQueueItemId: "q1",
      activeTabId: 53
    })
  });

  await harness.queueEngine.handleQueueAlarm();
  await harness.queueEngine.waitForIdle();

  const { queueItems, queueRuntime } = harness.getState();
  assert.equal(queueItems[0].status, "failed");
  assert.equal(queueItems[0].lastError, "Queue tab did not finish loading before timeout.");
  assert.equal(queueRuntime.status, "idle");
  assert.deepEqual(chromeMock.tabs.removed, [53]);
});

test("handleQueueTabRemoved fails active item and clears runtime context", async (t) => {
  const chromeMock = installChromeMock();
  t.after(() => chromeMock.restore());

  const harness = createQueueEngineHarness({
    queueItems: [createQueueItem({ id: "q1", url: "https://example.com/a", status: "opening_tab" })],
    queueRuntime: createQueueRuntime({
      status: "running",
      activeQueueItemId: "q1",
      activeTabId: 54
    })
  });

  await harness.queueEngine.handleQueueTabRemoved(54);
  await harness.queueEngine.waitForIdle();

  const { queueItems, queueRuntime } = harness.getState();
  assert.equal(queueItems[0].status, "failed");
  assert.equal(queueItems[0].lastError, "Queue tab was closed before loading completed.");
  assert.equal(queueRuntime.status, "idle");
});

test("recoverQueueEngineState resumes pending work after restart", async (t) => {
  const chromeMock = installChromeMock();
  t.after(() => chromeMock.restore());

  const harness = createQueueEngineHarness({
    queueItems: [createQueueItem({ id: "q1", url: "https://example.com/a" })],
    queueRuntime: createQueueRuntime({ status: "running" })
  });

  await harness.queueEngine.recoverQueueEngineState();
  await harness.queueEngine.waitForIdle();

  const { queueItems, queueRuntime } = harness.getState();
  assert.equal(queueItems[0].status, "opening_tab");
  assert.equal(queueRuntime.status, "running");
  assert.equal(queueRuntime.activeQueueItemId, "q1");
  assert.ok(Number.isInteger(queueRuntime.activeTabId));
  assert.equal(chromeMock.tabs.created.length, 1);
});

function createQueueEngineHarness({
  queueItems = [],
  queueRuntime = createQueueRuntime(),
  saveQueueItemWithProvider = async () => ({ ok: true })
} = {}) {
  let currentQueueItems = queueItems.map((item) => ({ ...item }));
  let currentQueueRuntime = { ...queueRuntime };

  const queueEngine = createQueueEngine({
    getQueueRuntime: async () => ({ ...currentQueueRuntime }),
    saveQueueRuntime: async (nextQueueRuntime) => {
      currentQueueRuntime = { ...nextQueueRuntime };
      return currentQueueRuntime;
    },
    getQueueItems: async () => currentQueueItems.map((item) => ({ ...item })),
    saveQueueItems: async (nextQueueItems) => {
      currentQueueItems = nextQueueItems.map((item) => ({ ...item }));
      return currentQueueItems;
    },
    saveQueueItemWithProvider
  });

  return {
    queueEngine,
    getState() {
      return {
        queueItems: currentQueueItems.map((item) => ({ ...item })),
        queueRuntime: { ...currentQueueRuntime }
      };
    }
  };
}

function createQueueRuntime(overrides = {}) {
  return {
    status: "idle",
    activeQueueItemId: null,
    activeTabId: null,
    updatedAt: Date.now(),
    ...overrides
  };
}

function createQueueItem({
  id,
  url,
  title = url,
  status = "pending",
  attempts = 0,
  lastError = undefined
}) {
  const queueItem = {
    id,
    url,
    title,
    status,
    attempts,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  if (typeof lastError === "string") {
    queueItem.lastError = lastError;
  }
  return queueItem;
}

function installChromeMock({ tabsById = new Map() } = {}) {
  const previousChrome = globalThis.chrome;
  let nextTabId = 100;

  const alarms = {
    created: [],
    cleared: []
  };
  const tabs = {
    created: [],
    removed: [],
    getCalls: []
  };

  globalThis.chrome = {
    alarms: {
      async create(name, details) {
        alarms.created.push({ name, details });
      },
      async clear(name) {
        alarms.cleared.push(name);
      }
    },
    tabs: {
      async create({ url, active }) {
        const tabId = nextTabId;
        nextTabId += 1;
        const tab = {
          id: tabId,
          url,
          status: "loading"
        };
        tabsById.set(tabId, tab);
        tabs.created.push({ id: tabId, url, active });
        return { ...tab };
      },
      async get(tabId) {
        tabs.getCalls.push(tabId);
        const tab = tabsById.get(tabId);
        if (!tab) {
          throw new Error(`Tab ${tabId} not found.`);
        }
        return { ...tab };
      },
      async remove(tabId) {
        tabs.removed.push(tabId);
        tabsById.delete(tabId);
      }
    }
  };

  return {
    alarms,
    tabs,
    restore() {
      if (previousChrome === undefined) {
        delete globalThis.chrome;
        return;
      }
      globalThis.chrome = previousChrome;
    }
  };
}
