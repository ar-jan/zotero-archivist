import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_SELECTOR_RULES, STORAGE_KEYS } from "../shared/protocol.js";
import {
  getCollectorSettings,
  getProviderDiagnostics,
  getQueueSettings,
  getQueueRuntime,
  getSelectorRules
} from "../background/storage-repo.js";

test("storage repo initializes collector settings defaults when missing", async (t) => {
  const chromeMock = installStorageChromeMock();
  t.after(() => chromeMock.restore());

  const collectorSettings = await getCollectorSettings();

  assert.equal(collectorSettings.maxLinksPerRun, 500);
  assert.equal(collectorSettings.autoScrollEnabled, true);
  assert.equal(collectorSettings.autoScrollMaxRounds, 30);
  assert.equal(collectorSettings.autoScrollIdleRounds, 3);
  assert.equal(collectorSettings.autoScrollSettleDelayMs, 750);
  assert.equal(chromeMock.writes.length, 1);
  assert.equal(Boolean(chromeMock.storageState[STORAGE_KEYS.COLLECTOR_SETTINGS]), true);
});

test("storage repo normalizes malformed collector settings and writes back", async (t) => {
  const chromeMock = installStorageChromeMock({
    [STORAGE_KEYS.COLLECTOR_SETTINGS]: {
      maxLinksPerRun: -7,
      autoScrollEnabled: "sometimes",
      autoScrollMaxRounds: -1,
      autoScrollIdleRounds: 99,
      autoScrollSettleDelayMs: -100
    }
  });
  t.after(() => chromeMock.restore());

  const collectorSettings = await getCollectorSettings();

  assert.equal(collectorSettings.maxLinksPerRun, 1);
  assert.equal(collectorSettings.autoScrollEnabled, true);
  assert.equal(collectorSettings.autoScrollMaxRounds, 1);
  assert.equal(collectorSettings.autoScrollIdleRounds, 20);
  assert.equal(collectorSettings.autoScrollSettleDelayMs, 100);
  assert.equal(chromeMock.writes.length, 1);
});

test("storage repo initializes queue settings defaults when missing", async (t) => {
  const chromeMock = installStorageChromeMock();
  t.after(() => chromeMock.restore());

  const queueSettings = await getQueueSettings();

  assert.equal(queueSettings.interItemDelayMs, 5000);
  assert.equal(queueSettings.interItemDelayJitterMs, 2000);
  assert.equal(chromeMock.writes.length, 1);
  assert.equal(Boolean(chromeMock.storageState[STORAGE_KEYS.QUEUE_SETTINGS]), true);
});

test("storage repo normalizes malformed queue settings and writes back", async (t) => {
  const chromeMock = installStorageChromeMock({
    [STORAGE_KEYS.QUEUE_SETTINGS]: {
      interItemDelayMs: -20,
      interItemDelayJitterMs: 999999
    }
  });
  t.after(() => chromeMock.restore());

  const queueSettings = await getQueueSettings();

  assert.equal(queueSettings.interItemDelayMs, 0);
  assert.equal(queueSettings.interItemDelayJitterMs, 60000);
  assert.equal(chromeMock.writes.length, 1);
});

test("storage repo initializes provider diagnostics defaults when missing", async (t) => {
  const chromeMock = installStorageChromeMock();
  t.after(() => chromeMock.restore());

  const diagnostics = await getProviderDiagnostics();

  assert.equal(diagnostics.connectorBridge.enabled, true);
  assert.equal(diagnostics.connectorBridge.healthy, false);
  assert.equal(chromeMock.writes.length, 1);
  assert.equal(Boolean(chromeMock.storageState[STORAGE_KEYS.PROVIDER_DIAGNOSTICS]), true);
});

test("storage repo normalizes malformed provider diagnostics and writes back", async (t) => {
  const chromeMock = installStorageChromeMock({
    [STORAGE_KEYS.PROVIDER_DIAGNOSTICS]: {
      connectorBridge: {
        enabled: false,
        healthy: "yes",
        connectorAvailable: "maybe",
        zoteroOnline: false
      },
      lastError: "",
      updatedAt: -1
    }
  });
  t.after(() => chromeMock.restore());

  const diagnostics = await getProviderDiagnostics();

  assert.equal(diagnostics.connectorBridge.enabled, true);
  assert.equal(diagnostics.connectorBridge.healthy, false);
  assert.equal(diagnostics.connectorBridge.connectorAvailable, null);
  assert.equal(diagnostics.connectorBridge.zoteroOnline, false);
  assert.equal(chromeMock.writes.length, 1);
});

test("storage repo migrates legacy anchor-only selector defaults", async (t) => {
  const chromeMock = installStorageChromeMock({
    [STORAGE_KEYS.SELECTOR_RULES]: [
      {
        id: "anchors",
        name: "All anchor links",
        cssSelector: "a[href]",
        urlAttribute: "href",
        enabled: true
      }
    ]
  });
  t.after(() => chromeMock.restore());

  const rules = await getSelectorRules();

  assert.equal(rules.length, DEFAULT_SELECTOR_RULES.length);
  assert.equal(rules[0].id, DEFAULT_SELECTOR_RULES[0].id);
  assert.equal(chromeMock.writes.length, 1);
});

test("storage repo normalizes malformed queue runtime and writes back", async (t) => {
  const chromeMock = installStorageChromeMock({
    [STORAGE_KEYS.QUEUE_RUNTIME]: {
      status: "running",
      activeQueueItemId: "q1",
      activeTabId: null,
      updatedAt: 10
    }
  });
  t.after(() => chromeMock.restore());

  const queueRuntime = await getQueueRuntime();

  assert.equal(queueRuntime.status, "running");
  assert.equal(queueRuntime.activeQueueItemId, null);
  assert.equal(queueRuntime.activeTabId, null);
  assert.equal(chromeMock.writes.length, 1);
});

function installStorageChromeMock(initialState = {}) {
  const previousChrome = globalThis.chrome;
  const storageState = { ...initialState };
  const writes = [];

  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          if (typeof key === "string") {
            return {
              [key]: storageState[key]
            };
          }

          return {};
        },
        async set(value) {
          writes.push(value);
          Object.assign(storageState, value);
        }
      }
    }
  };

  return {
    storageState,
    writes,
    restore() {
      if (previousChrome === undefined) {
        delete globalThis.chrome;
        return;
      }

      globalThis.chrome = previousChrome;
    }
  };
}
