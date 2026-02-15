import test from "node:test";
import assert from "node:assert/strict";

import { createPanelStore } from "../sidepanel/store.js";

test("panel store normalizes provider settings and diagnostics defaults", () => {
  const panelStore = createPanelStore();

  assert.equal(panelStore.state.providerDiagnostics.connectorBridge.enabled, true);
  assert.equal(panelStore.state.providerDiagnostics.connectorBridge.healthy, false);
  assert.equal(panelStore.state.providerDiagnostics.connectorBridge.bridgeReady, null);
  assert.equal(panelStore.state.queueSettings.interItemDelayMs, 5000);
  assert.equal(panelStore.state.queueSettings.interItemDelayJitterMs, 2000);
});

test("panel store normalizes queue settings updates", () => {
  const panelStore = createPanelStore();

  const queueSettings = panelStore.setQueueSettings({
    interItemDelayMs: -1,
    interItemDelayJitterMs: 999999
  });

  assert.equal(queueSettings.interItemDelayMs, 0);
  assert.equal(queueSettings.interItemDelayJitterMs, 60000);
});

test("panel store tracks integration in-progress state separately from queue state", () => {
  const panelStore = createPanelStore();

  assert.equal(panelStore.isIntegrationBusy(), false);
  panelStore.setIntegrationInProgress(true);
  assert.equal(panelStore.isIntegrationBusy(), true);
  panelStore.setIntegrationInProgress(false);
  assert.equal(panelStore.isIntegrationBusy(), false);

  assert.equal(panelStore.isQueueBusy(), false);
  panelStore.setQueueLifecycleInProgress(true);
  assert.equal(panelStore.isQueueBusy(), true);
  panelStore.setQueueLifecycleInProgress(false);
  assert.equal(panelStore.isQueueBusy(), false);
});
