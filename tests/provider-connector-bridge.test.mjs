import test from "node:test";
import assert from "node:assert/strict";

import { createConnectorBridgeProvider } from "../zotero/provider-connector-bridge.js";
import { QUEUE_ZOTERO_SAVE_MODES } from "../shared/state.js";
import { installBridgeChromeMock } from "./test-helpers/bridge-chrome-mock.mjs";

test("connector bridge health check reports probe requirement when no eligible tab is available", async (t) => {
  const chromeMock = installBridgeChromeMock({
    queryTabs: async () => []
  });
  t.after(() => chromeMock.restore());

  const provider = createConnectorBridgeProvider();
  const result = await provider.checkHealth();

  assert.equal(result.ok, false);
  assert.equal(result.bridgeReady, false);
  assert.equal(result.connectorAvailable, null);
  assert.equal(result.zoteroOnline, null);
  assert.match(result.message, /probe requires an open http\(s\) tab/i);
});

test("connector bridge health check reports healthy when connector reports online", async (t) => {
  const chromeMock = installBridgeChromeMock({
    executeScriptResponder: async ({ commandName }) => {
      if (commandName === "Connector.checkIsOnline") {
        return { ok: true, result: true };
      }
      return { ok: false, error: `Unexpected command: ${String(commandName)}` };
    },
    permissionsContains: async () => true,
    tabsById: new Map([
      [1, { id: 1, url: "https://example.com/page", title: "Example" }]
    ])
  });
  t.after(() => chromeMock.restore());

  const provider = createConnectorBridgeProvider();
  const result = await provider.checkHealth({ tabId: 1 });

  assert.equal(result.ok, true);
  assert.equal(result.bridgeReady, true);
  assert.equal(result.connectorAvailable, true);
  assert.equal(result.zoteroOnline, true);
  assert.match(result.message, /available/i);
});

test("connector bridge health check maps iframe-loading failures to connector-unavailable", async (t) => {
  const chromeMock = installBridgeChromeMock({
    executeScriptResponder: async () => ({
      ok: false,
      error: "Unable to load Zotero connector bridge iframe."
    }),
    permissionsContains: async () => true,
    tabsById: new Map([
      [2, { id: 2, url: "https://example.com/page", title: "Example" }]
    ])
  });
  t.after(() => chromeMock.restore());

  const provider = createConnectorBridgeProvider();
  const result = await provider.checkHealth({ tabId: 2 });

  assert.equal(result.ok, false);
  assert.equal(result.bridgeReady, false);
  assert.equal(result.connectorAvailable, false);
  assert.equal(result.zoteroOnline, null);
  assert.match(result.message, /extension is unavailable/i);
});

test("connector bridge saveWebPageWithSnapshot runs injection, online check, then save command", async (t) => {
  const observedCommands = [];
  let observedSaveCommandArgs = null;
  const chromeMock = installBridgeChromeMock({
    executeScriptResponder: async ({ commandName, commandArgs }) => {
      observedCommands.push(commandName);
      if (commandName === "Connector_Browser.injectTranslationScripts") {
        return { ok: true, result: true };
      }
      if (commandName === "Connector.checkIsOnline") {
        return { ok: true, result: true };
      }
      if (commandName === "Messaging.sendMessage") {
        observedSaveCommandArgs = commandArgs;
        return { ok: true, result: { ok: true } };
      }
      return { ok: false, error: `Unexpected command: ${String(commandName)}` };
    },
    tabsById: new Map([
      [3, { id: 3, url: "https://example.com/article", title: "Article" }]
    ])
  });
  t.after(() => chromeMock.restore());

  const provider = createConnectorBridgeProvider();
  const result = await provider.saveWebPageWithSnapshot({
    tabId: 3,
    url: "https://example.com/article",
    title: "Article"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(observedCommands, [
    "Connector_Browser.injectTranslationScripts",
    "Connector.checkIsOnline",
    "Messaging.sendMessage"
  ]);
  assert.deepEqual(observedSaveCommandArgs, [
    "saveAsWebpage",
    ["Article", { snapshot: true }],
    3,
    0
  ]);
});

test("connector bridge saveWebPageWithSnapshot supports Embedded Metadata mode and honors snapshot pref", async (t) => {
  let observedSaveCommandArgs = null;
  const chromeMock = installBridgeChromeMock({
    executeScriptResponder: async ({ commandName, commandArgs }) => {
      if (commandName === "Connector_Browser.injectTranslationScripts") {
        return { ok: true, result: true };
      }
      if (commandName === "Connector.checkIsOnline") {
        return { ok: true, result: true };
      }
      if (commandName === "Connector.getPref") {
        return { ok: true, result: false };
      }
      if (commandName === "Messaging.sendMessage") {
        observedSaveCommandArgs = commandArgs;
        return { ok: true, result: { ok: true } };
      }
      return { ok: false, error: `Unexpected command: ${String(commandName)}` };
    },
    tabsById: new Map([
      [31, { id: 31, url: "https://example.com/article", title: "Article" }]
    ])
  });
  t.after(() => chromeMock.restore());

  const provider = createConnectorBridgeProvider();
  const result = await provider.saveWebPageWithSnapshot({
    tabId: 31,
    url: "https://example.com/article",
    title: "Article",
    zoteroSaveMode: QUEUE_ZOTERO_SAVE_MODES.EMBEDDED_METADATA
  });

  assert.equal(result.ok, true);
  assert.deepEqual(observedSaveCommandArgs, [
    "saveAsWebpage",
    ["Article", { snapshot: false }],
    31,
    0
  ]);
});

test("connector bridge saveWebPageWithSnapshot fails when connector reports offline", async (t) => {
  const chromeMock = installBridgeChromeMock({
    executeScriptResponder: async ({ commandName }) => {
      if (commandName === "Connector_Browser.injectTranslationScripts") {
        return { ok: true, result: true };
      }
      if (commandName === "Connector.checkIsOnline") {
        return { ok: true, result: false };
      }
      return { ok: false, error: "Unexpected command." };
    },
    tabsById: new Map([
      [4, { id: 4, url: "https://example.com/offline", title: "Offline Case" }]
    ])
  });
  t.after(() => chromeMock.restore());

  const provider = createConnectorBridgeProvider();
  const result = await provider.saveWebPageWithSnapshot({
    tabId: 4
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /offline for bridge save/i);
});

test("connector bridge embedded mode defaults to snapshot when pref lookup fails", async (t) => {
  let observedSaveCommandArgs = null;
  const chromeMock = installBridgeChromeMock({
    executeScriptResponder: async ({ commandName, commandArgs }) => {
      if (commandName === "Connector_Browser.injectTranslationScripts") {
        return { ok: true, result: true };
      }
      if (commandName === "Connector.checkIsOnline") {
        return { ok: true, result: true };
      }
      if (commandName === "Connector.getPref") {
        return { ok: false, error: "pref lookup failed" };
      }
      if (commandName === "Messaging.sendMessage") {
        observedSaveCommandArgs = commandArgs;
        return { ok: true, result: { ok: true } };
      }
      return { ok: false, error: "Unexpected command." };
    },
    tabsById: new Map([
      [41, { id: 41, url: "https://example.com/default", title: "Default Case" }]
    ])
  });
  t.after(() => chromeMock.restore());

  const provider = createConnectorBridgeProvider();
  const result = await provider.saveWebPageWithSnapshot({
    tabId: 41,
    zoteroSaveMode: QUEUE_ZOTERO_SAVE_MODES.EMBEDDED_METADATA
  });

  assert.equal(result.ok, true);
  assert.deepEqual(observedSaveCommandArgs, [
    "saveAsWebpage",
    ["Default Case", { snapshot: true }],
    41,
    0
  ]);
});

test("connector bridge saveWebPageWithSnapshot fails when preparation step fails", async (t) => {
  const chromeMock = installBridgeChromeMock({
    executeScriptResponder: async ({ commandName }) => {
      if (commandName === "Connector_Browser.injectTranslationScripts") {
        return { ok: false, error: "translation prepare failed" };
      }
      return { ok: false, error: "Unexpected command." };
    },
    tabsById: new Map([
      [5, { id: 5, url: "https://example.com/failure", title: "Failure Case" }]
    ])
  });
  t.after(() => chromeMock.restore());

  const provider = createConnectorBridgeProvider();
  const result = await provider.saveWebPageWithSnapshot({
    tabId: 5
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /could not prepare translation scripts/i);
});
