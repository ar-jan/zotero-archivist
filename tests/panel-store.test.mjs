import test from "node:test";
import assert from "node:assert/strict";

import { createPanelStore } from "../sidepanel/store.js";

test("panel store normalizes provider settings and diagnostics defaults", () => {
  const panelStore = createPanelStore();

  assert.equal(panelStore.state.providerDiagnostics.connectorBridge.enabled, true);
  assert.equal(panelStore.state.providerDiagnostics.connectorBridge.healthy, false);
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
