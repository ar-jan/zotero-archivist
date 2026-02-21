import test from "node:test";
import assert from "node:assert/strict";

import { createProviderOrchestrator } from "../background/provider-orchestrator.js";
import { QUEUE_ZOTERO_SAVE_MODES } from "../shared/state.js";

test("provider orchestrator resolves active provider when health check succeeds", async () => {
  const diagnosticsWrites = [];
  const orchestrator = createProviderOrchestrator({
    createConnectorBridgeProviderImpl: () => ({
      mode: "connector_bridge",
      checkHealth: async () => ({
        ok: true,
        message: "online",
        bridgeReady: true,
        connectorAvailable: true,
        zoteroOnline: true
      }),
      saveWebPageWithSnapshot: async () => ({ ok: true })
    }),
    saveProviderDiagnostics: async (diagnostics) => {
      diagnosticsWrites.push(diagnostics);
      return diagnostics;
    }
  });

  const result = await orchestrator.resolveSaveProvider();

  assert.equal(result.provider?.mode, "connector_bridge");
  assert.equal(result.diagnostics.connectorBridge.enabled, true);
  assert.equal(result.diagnostics.connectorBridge.healthy, true);
  assert.equal(result.diagnostics.connectorBridge.bridgeReady, true);
  assert.equal(result.diagnostics.connectorBridge.connectorAvailable, true);
  assert.equal(result.diagnostics.connectorBridge.zoteroOnline, true);
  assert.equal(diagnosticsWrites.length, 1);
});

test("provider orchestrator resolves no provider when health check fails", async () => {
  const diagnosticsWrites = [];
  const orchestrator = createProviderOrchestrator({
    createConnectorBridgeProviderImpl: () => ({
      mode: "connector_bridge",
      checkHealth: async () => ({
        ok: false,
        message: "bridge unavailable",
        bridgeReady: false,
        connectorAvailable: false,
        zoteroOnline: null
      }),
      saveWebPageWithSnapshot: async () => ({ ok: true })
    }),
    saveProviderDiagnostics: async (diagnostics) => {
      diagnosticsWrites.push(diagnostics);
      return diagnostics;
    },
  });

  const result = await orchestrator.resolveSaveProvider();

  assert.equal(result.provider, null);
  assert.equal(result.diagnostics.connectorBridge.enabled, true);
  assert.equal(result.diagnostics.connectorBridge.healthy, false);
  assert.equal(result.diagnostics.connectorBridge.bridgeReady, false);
  assert.equal(result.diagnostics.connectorBridge.connectorAvailable, false);
  assert.equal(result.diagnostics.connectorBridge.zoteroOnline, null);
  assert.equal(result.unavailableReason, "bridge unavailable");
  assert.equal(diagnosticsWrites.length, 1);
});

test("provider orchestrator saveQueueItemWithProvider returns unavailable message when provider is unhealthy", async () => {
  const diagnosticsWrites = [];
  const orchestrator = createProviderOrchestrator({
    createConnectorBridgeProviderImpl: () => ({
      mode: "connector_bridge",
      checkHealth: async () => ({
        ok: false,
        message: "probe failed",
        bridgeReady: false,
        connectorAvailable: false,
        zoteroOnline: null
      }),
      saveWebPageWithSnapshot: async () => ({ ok: true })
    }),
    saveProviderDiagnostics: async (diagnostics) => {
      diagnosticsWrites.push(diagnostics);
      return diagnostics;
    }
  });

  const result = await orchestrator.saveQueueItemWithProvider({
    queueItem: { url: "https://example.com/a", title: "A" },
    tabId: 99
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /Connector bridge is unavailable\./i);
  assert.match(result.error, /probe failed/i);
  assert.match(diagnosticsWrites.at(-1).lastError, /probe failed/i);
});

test("provider orchestrator saveQueueItemWithProvider normalizes invalid save mode and keeps diagnostics clean", async () => {
  const diagnosticsWrites = [];
  let observedSaveInput = null;
  const orchestrator = createProviderOrchestrator({
    createConnectorBridgeProviderImpl: () => ({
      mode: "connector_bridge",
      checkHealth: async () => ({
        ok: true,
        message: "online",
        bridgeReady: true,
        connectorAvailable: true,
        zoteroOnline: true
      }),
      saveWebPageWithSnapshot: async (input) => {
        observedSaveInput = input;
        return { ok: true };
      }
    }),
    saveProviderDiagnostics: async (diagnostics) => {
      diagnosticsWrites.push(diagnostics);
      return diagnostics;
    }
  });

  const result = await orchestrator.saveQueueItemWithProvider({
    queueItem: { url: "https://example.com/save", title: "Save" },
    tabId: 12,
    zoteroSaveMode: "unsupported_mode"
  });

  assert.equal(result.ok, true);
  assert.equal(observedSaveInput?.zoteroSaveMode, QUEUE_ZOTERO_SAVE_MODES.WEBPAGE_WITH_SNAPSHOT);
  assert.equal(diagnosticsWrites.at(-1).lastError, null);
});

test("provider orchestrator saveQueueItemWithProvider captures provider failure in diagnostics", async () => {
  const diagnosticsWrites = [];
  const orchestrator = createProviderOrchestrator({
    createConnectorBridgeProviderImpl: () => ({
      mode: "connector_bridge",
      checkHealth: async () => ({
        ok: true,
        message: "online",
        bridgeReady: true,
        connectorAvailable: true,
        zoteroOnline: true
      }),
      saveWebPageWithSnapshot: async () => ({ ok: false, error: "offline" })
    }),
    saveProviderDiagnostics: async (diagnostics) => {
      diagnosticsWrites.push(diagnostics);
      return diagnostics;
    }
  });

  const result = await orchestrator.saveQueueItemWithProvider({
    queueItem: { url: "https://example.com/offline", title: "Offline" },
    tabId: 13
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /offline/i);
  assert.match(diagnosticsWrites.at(-1).lastError, /offline/i);
});
