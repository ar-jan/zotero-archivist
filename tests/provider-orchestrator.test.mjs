import test from "node:test";
import assert from "node:assert/strict";

import { createProviderOrchestrator } from "../background/provider-orchestrator.js";
import { installBridgeChromeMock } from "./test-helpers/bridge-chrome-mock.mjs";

test("provider orchestrator resolves no provider when connector bridge is disabled", async () => {
  const diagnosticsWrites = [];
  const orchestrator = createProviderOrchestrator({
    getProviderSettings: async () => ({ connectorBridgeEnabled: false }),
    saveProviderDiagnostics: async (diagnostics) => {
      diagnosticsWrites.push(diagnostics);
      return diagnostics;
    }
  });

  const result = await orchestrator.resolveSaveProvider();

  assert.equal(result.provider, null);
  assert.equal(result.diagnostics.connectorBridge.enabled, false);
  assert.equal(result.diagnostics.connectorBridge.healthy, false);
  assert.equal(result.unavailableReason, null);
  assert.equal(diagnosticsWrites.length, 1);
});

test("provider orchestrator resolves connector bridge provider when health check succeeds", async (t) => {
  const chromeMock = installBridgeChromeMock({
    executeScriptResponder: async ({ commandName }) => {
      if (commandName === "Connector.checkIsOnline") {
        return { ok: true, result: true };
      }
      return { ok: false, error: `Unexpected command: ${String(commandName)}` };
    },
    permissionsContains: async () => true,
    tabsById: new Map([
      [11, { id: 11, url: "https://example.com/health", title: "Health" }]
    ])
  });
  t.after(() => chromeMock.restore());

  const diagnosticsWrites = [];
  const orchestrator = createProviderOrchestrator({
    getProviderSettings: async () => ({ connectorBridgeEnabled: true }),
    saveProviderDiagnostics: async (diagnostics) => {
      diagnosticsWrites.push(diagnostics);
      return diagnostics;
    }
  });

  const result = await orchestrator.resolveSaveProvider({ tabId: 11 });

  assert.equal(result.provider?.mode, "connector_bridge");
  assert.equal(result.diagnostics.connectorBridge.enabled, true);
  assert.equal(result.diagnostics.connectorBridge.healthy, true);
  assert.equal(result.diagnostics.connectorBridge.connectorAvailable, true);
  assert.equal(result.diagnostics.connectorBridge.zoteroOnline, true);
  assert.equal(diagnosticsWrites.length, 1);
});

test("provider orchestrator saveQueueItemWithProvider returns disabled message when provider is unavailable", async () => {
  const diagnosticsWrites = [];
  const orchestrator = createProviderOrchestrator({
    getProviderSettings: async () => ({ connectorBridgeEnabled: false }),
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
  assert.equal(result.error, "Connector bridge is disabled.");
  assert.match(diagnosticsWrites.at(-1).lastError, /disabled/i);
});

test("provider orchestrator saveQueueItemWithProvider reports success and keeps diagnostics clean", async (t) => {
  const chromeMock = installBridgeChromeMock({
    executeScriptResponder: async ({ commandName }) => {
      if (commandName === "Connector.checkIsOnline") {
        return { ok: true, result: true };
      }
      if (commandName === "Connector_Browser.injectTranslationScripts") {
        return { ok: true, result: true };
      }
      if (commandName === "Messaging.sendMessage") {
        return { ok: true, result: { ok: true } };
      }
      return { ok: false, error: `Unexpected command: ${String(commandName)}` };
    },
    permissionsContains: async () => true,
    tabsById: new Map([
      [12, { id: 12, url: "https://example.com/save", title: "Save" }]
    ])
  });
  t.after(() => chromeMock.restore());

  const diagnosticsWrites = [];
  const orchestrator = createProviderOrchestrator({
    getProviderSettings: async () => ({ connectorBridgeEnabled: true }),
    saveProviderDiagnostics: async (diagnostics) => {
      diagnosticsWrites.push(diagnostics);
      return diagnostics;
    }
  });

  const result = await orchestrator.saveQueueItemWithProvider({
    queueItem: { url: "https://example.com/save", title: "Save" },
    tabId: 12
  });

  assert.equal(result.ok, true);
  assert.equal(diagnosticsWrites.at(-1).lastError, null);
});

test("provider orchestrator saveQueueItemWithProvider captures provider failure in diagnostics", async (t) => {
  const chromeMock = installBridgeChromeMock({
    executeScriptResponder: async ({ commandName }) => {
      if (commandName === "Connector.checkIsOnline") {
        return { ok: true, result: false };
      }
      if (commandName === "Connector_Browser.injectTranslationScripts") {
        return { ok: true, result: true };
      }
      return { ok: false, error: `Unexpected command: ${String(commandName)}` };
    },
    permissionsContains: async () => true,
    tabsById: new Map([
      [13, { id: 13, url: "https://example.com/offline", title: "Offline" }]
    ])
  });
  t.after(() => chromeMock.restore());

  const diagnosticsWrites = [];
  const orchestrator = createProviderOrchestrator({
    getProviderSettings: async () => ({ connectorBridgeEnabled: true }),
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
