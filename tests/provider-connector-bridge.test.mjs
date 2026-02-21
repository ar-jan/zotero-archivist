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

test("connector bridge saveWebPageWithSnapshot uses Embedded Metadata translator when configured", async (t) => {
  let observedTranslatorSaveArgs = null;
  const chromeMock = installBridgeChromeMock({
    executeScriptResponder: async ({ commandName, commandArgs }) => {
      if (commandName === "Connector_Browser.injectTranslationScripts") {
        return { ok: true, result: true };
      }
      if (commandName === "Connector.checkIsOnline") {
        return { ok: true, result: true };
      }
      if (commandName === "Connector_Browser.getTabInfo") {
        return {
          ok: true,
          result: {
            translators: [
              { label: "DOI" },
              { label: "Embedded Metadata" }
            ]
          }
        };
      }
      if (commandName === "Connector_Browser.saveWithTranslator") {
        observedTranslatorSaveArgs = commandArgs;
        return { ok: true, result: [{ itemType: "webpage", title: "Article" }] };
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
  assert.deepEqual(observedTranslatorSaveArgs, [
    { id: 31, title: "Article", url: "https://example.com/article" },
    1,
    { fallbackOnFailure: false }
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

test("connector bridge embedded mode fails when Embedded Metadata translator is unavailable", async (t) => {
  const chromeMock = installBridgeChromeMock({
    executeScriptResponder: async ({ commandName }) => {
      if (commandName === "Connector_Browser.injectTranslationScripts") {
        return { ok: true, result: true };
      }
      if (commandName === "Connector.checkIsOnline") {
        return { ok: true, result: true };
      }
      if (commandName === "Connector_Browser.getTabInfo") {
        return {
          ok: true,
          result: {
            translators: [{ label: "DOI" }]
          }
        };
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

  assert.equal(result.ok, false);
  assert.match(result.error, /embedded metadata translator is unavailable/i);
});

test("connector bridge embedded mode treats empty translator lists as unavailable", async (t) => {
  const chromeMock = installBridgeChromeMock({
    executeScriptResponder: async ({ commandName }) => {
      if (commandName === "Connector_Browser.injectTranslationScripts") {
        return { ok: true, result: true };
      }
      if (commandName === "Connector.checkIsOnline") {
        return { ok: true, result: true };
      }
      if (commandName === "Connector_Browser.getTabInfo") {
        return {
          ok: true,
          result: {
            translators: []
          }
        };
      }
      return { ok: false, error: "Unexpected command." };
    },
    tabsById: new Map([
      [43, { id: 43, url: "https://example.com/no-translators", title: "No Translators" }]
    ])
  });
  t.after(() => chromeMock.restore());

  const provider = createConnectorBridgeProvider();
  const result = await provider.saveWebPageWithSnapshot({
    tabId: 43,
    zoteroSaveMode: QUEUE_ZOTERO_SAVE_MODES.EMBEDDED_METADATA
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /embedded metadata translator is unavailable/i);
  assert.doesNotMatch(result.error, /timed out while waiting for embedded metadata translator/i);
});

test(
  "connector bridge embedded mode refreshes translator detection when tab info has no translators state yet",
  async (t) => {
    let refreshObserved = false;
    let observedRefreshCommandArgs = null;
    let observedPingCommandArgs = null;
    let getTabInfoCalls = 0;

    const chromeMock = installBridgeChromeMock({
      executeScriptResponder: async ({ commandName, commandArgs }) => {
        if (commandName === "Connector_Browser.injectTranslationScripts") {
          return { ok: true, result: true };
        }
        if (commandName === "Connector.checkIsOnline") {
          return { ok: true, result: true };
        }
        if (commandName === "Connector_Browser.getTabInfo") {
          getTabInfoCalls += 1;
          return {
            ok: true,
            result: {
              translators: refreshObserved ? [{ label: "Embedded Metadata" }] : null
            }
          };
        }
        if (commandName === "Messaging.sendMessage") {
          if (commandArgs?.[0] === "pageModified") {
            observedRefreshCommandArgs = commandArgs;
            refreshObserved = true;
            return { ok: true, result: true };
          }
          if (commandArgs?.[0] === "ping") {
            observedPingCommandArgs = commandArgs;
            return { ok: true, result: "pong" };
          }
          return { ok: false, error: `Unexpected messaging command: ${String(commandArgs?.[0])}` };
        }
        if (commandName === "Connector_Browser.saveWithTranslator") {
          return { ok: true, result: [{ itemType: "webpage", title: "Refreshed Article" }] };
        }
        return { ok: false, error: "Unexpected command." };
      },
      tabsById: new Map([
        [44, { id: 44, url: "https://example.com/needs-refresh", title: "Needs Refresh" }]
      ])
    });
    t.after(() => chromeMock.restore());

    const provider = createConnectorBridgeProvider();
    const result = await provider.saveWebPageWithSnapshot({
      tabId: 44,
      zoteroSaveMode: QUEUE_ZOTERO_SAVE_MODES.EMBEDDED_METADATA
    });

    assert.equal(result.ok, true);
    assert.equal(refreshObserved, true);
    assert.ok(getTabInfoCalls >= 2);
    assert.deepEqual(observedRefreshCommandArgs, ["pageModified", null, 44, null]);
    assert.deepEqual(observedPingCommandArgs, ["ping", null, 44, 0]);
  }
);

test("connector bridge embedded mode fails when translator save returns no items", async (t) => {
  const chromeMock = installBridgeChromeMock({
    executeScriptResponder: async ({ commandName }) => {
      if (commandName === "Connector_Browser.injectTranslationScripts") {
        return { ok: true, result: true };
      }
      if (commandName === "Connector.checkIsOnline") {
        return { ok: true, result: true };
      }
      if (commandName === "Connector_Browser.getTabInfo") {
        return {
          ok: true,
          result: {
            translators: [{ label: "Embedded Metadata" }]
          }
        };
      }
      if (commandName === "Connector_Browser.saveWithTranslator") {
        return { ok: true, result: undefined };
      }
      return { ok: false, error: "Unexpected command." };
    },
    tabsById: new Map([
      [42, { id: 42, url: "https://example.com/no-items", title: "No Items Case" }]
    ])
  });
  t.after(() => chromeMock.restore());

  const provider = createConnectorBridgeProvider();
  const result = await provider.saveWebPageWithSnapshot({
    tabId: 42,
    zoteroSaveMode: QUEUE_ZOTERO_SAVE_MODES.EMBEDDED_METADATA
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /returned no saved items/i);
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
