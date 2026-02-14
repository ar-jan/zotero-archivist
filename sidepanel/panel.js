import {
  ERROR_CODES,
  STORAGE_KEYS,
  isHttpUrl
} from "../shared/protocol.js";
import { getQueueItemCounts } from "../shared/state.js";
import {
  authorQueueFromSelectionAction,
  clearQueueAction,
  collectLinksAction,
  ensureHostPermissionAction,
  ensureHostPermissionsForUrlsAction,
  getActiveTabAction,
  getPanelStateAction,
  queueLifecycleAction,
  setCollectedLinksAction,
  setSelectorRulesAction
} from "./actions.js";
import {
  getFilteredLinks as getFilteredLinksView,
  initializeSectionToggle,
  normalizeFilterQuery as normalizeFilterQueryValue,
  renderIntegrationState as renderIntegrationStateView,
  renderLinks as renderLinksView,
  renderQueue as renderQueueView,
  renderQueueRuntimeStatus as renderQueueRuntimeStatusView
} from "./render.js";
import { createLinkCurationController } from "./link-curation-controller.js";
import { createQueueController } from "./queue-controller.js";
import { createSelectorController } from "./selector-controller.js";
import { createPanelStore } from "./store.js";

const collectButton = document.getElementById("collect-links-button");
const addRuleButton = document.getElementById("add-rule-button");
const saveRulesButton = document.getElementById("save-rules-button");
const selectorsToggleButton = document.getElementById("selectors-toggle-button");
const selectorsBodyEl = document.getElementById("selectors-body");
const selectorRulesListEl = document.getElementById("selector-rules-list");
const statusEl = document.getElementById("status");
const resultsToggleButton = document.getElementById("results-toggle-button");
const resultsBodyEl = document.getElementById("results-body");
const resultsTitleEl = document.getElementById("results-title");
const resultsSummaryEl = document.getElementById("results-summary");
const resultsListEl = document.getElementById("results-list");
const selectAllLinksButton = document.getElementById("select-all-links-button");
const deselectAllLinksButton = document.getElementById("deselect-all-links-button");
const clearAllLinksButton = document.getElementById("clear-all-links-button");
const invertLinksButton = document.getElementById("invert-links-button");
const resultsFilterInput = document.getElementById("results-filter-input");
const queueTitleEl = document.getElementById("queue-title");
const queueSummaryEl = document.getElementById("queue-summary");
const queueRuntimeStatusEl = document.getElementById("queue-runtime-status");
const queueListEl = document.getElementById("queue-list");
const addSelectedToQueueButton = document.getElementById("add-selected-to-queue-button");
const clearQueueButton = document.getElementById("clear-queue-button");
const startQueueButton = document.getElementById("start-queue-button");
const pauseQueueButton = document.getElementById("pause-queue-button");
const resumeQueueButton = document.getElementById("resume-queue-button");
const stopQueueButton = document.getElementById("stop-queue-button");
const retryFailedQueueButton = document.getElementById("retry-failed-queue-button");
const rulesSummaryEl = document.getElementById("rules-summary");
const integrationModeEl = document.getElementById("integration-mode");
const refreshDiagnosticsButton = document.getElementById("refresh-diagnostics-button");
const integrationUpdatedAtEl = document.getElementById("integration-updated-at");
const integrationBridgeRowEl = document.getElementById("integration-bridge-row");
const integrationBridgeStatusEl = document.getElementById("integration-bridge-status");
const integrationConnectorRowEl = document.getElementById("integration-connector-row");
const integrationConnectorStatusEl = document.getElementById("integration-connector-status");
const integrationZoteroRowEl = document.getElementById("integration-zotero-row");
const integrationZoteroStatusEl = document.getElementById("integration-zotero-status");
const integrationErrorEl = document.getElementById("integration-error");

const panelStore = createPanelStore(normalizeFilterQueryValue(resultsFilterInput.value));
const panelState = panelStore.state;

const queueController = createQueueController({
  panelStore,
  getCollectedLinks: () => panelState.collectedLinks,
  getQueueItems: () => panelState.queueItems,
  getQueueRuntime: () => panelState.queueRuntime,
  queueLifecycleActionImpl: queueLifecycleAction,
  ensureHostPermissionsForUrlsActionImpl: ensureHostPermissionsForUrlsAction,
  authorQueueFromSelectionActionImpl: authorQueueFromSelectionAction,
  clearQueueActionImpl: clearQueueAction,
  setQueueItemsState,
  setQueueRuntimeState,
  updateQueueActionState,
  setStatus,
  messageFromError
});

const selectorController = createSelectorController({
  panelStore,
  selectorRulesListEl,
  rulesSummaryEl,
  saveRulesButton,
  setSelectorRulesActionImpl: setSelectorRulesAction,
  setStatus,
  messageFromError
});

const linkCurationController = createLinkCurationController({
  panelStore,
  getCollectedLinks: () => panelState.collectedLinks,
  getResultsFilterQuery: () => panelState.resultsFilterQuery,
  getFilteredLinksImpl: getFilteredLinksView,
  setCollectedLinksActionImpl: setCollectedLinksAction,
  setCollectedLinksState,
  setStatus,
  messageFromError
});

collectButton.addEventListener("click", () => {
  void collectLinks();
});

addRuleButton.addEventListener("click", () => {
  selectorController.addSelectorRule();
});

saveRulesButton.addEventListener("click", () => {
  void selectorController.saveSelectorRules();
});

selectorRulesListEl.addEventListener("click", (event) => {
  selectorController.handleSelectorRuleListClick(event);
});

selectorRulesListEl.addEventListener("input", () => {
  selectorController.markSelectorRulesDirty();
});

selectorRulesListEl.addEventListener("change", () => {
  selectorController.markSelectorRulesDirty();
});

resultsListEl.addEventListener("change", (event) => {
  void linkCurationController.handleResultsListChange(event);
});

selectAllLinksButton.addEventListener("click", () => {
  void linkCurationController.setFilteredLinksSelectedState(true);
});

deselectAllLinksButton.addEventListener("click", () => {
  void linkCurationController.setFilteredLinksSelectedState(false);
});

invertLinksButton.addEventListener("click", () => {
  void linkCurationController.invertFilteredLinkSelection();
});

clearAllLinksButton.addEventListener("click", () => {
  void linkCurationController.clearCollectedLinks();
});

resultsFilterInput.addEventListener("input", () => {
  panelState.resultsFilterQuery = normalizeFilterQueryValue(resultsFilterInput.value);
  renderLinks(panelState.collectedLinks);
});

addSelectedToQueueButton.addEventListener("click", () => {
  void queueController.addSelectedLinksToQueue();
});

clearQueueButton.addEventListener("click", () => {
  void queueController.clearQueueItems();
});

startQueueButton.addEventListener("click", () => {
  void queueController.startQueueProcessing();
});

pauseQueueButton.addEventListener("click", () => {
  void queueController.pauseQueueProcessing();
});

resumeQueueButton.addEventListener("click", () => {
  void queueController.resumeQueueProcessing();
});

stopQueueButton.addEventListener("click", () => {
  void queueController.stopQueueProcessing();
});

retryFailedQueueButton.addEventListener("click", () => {
  void queueController.retryFailedQueueItems();
});

refreshDiagnosticsButton.addEventListener("click", () => {
  void refreshIntegrationDiagnostics();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  handleStorageChange(changes, areaName);
});

initializeSectionToggle(selectorsToggleButton, selectorsBodyEl);
initializeSectionToggle(resultsToggleButton, resultsBodyEl);
renderIntegrationState();
updateQueueActionState();

void loadPanelState();

async function loadPanelState() {
  setStatus("Loading panel state...");

  const response = await getPanelStateAction();

  if (!response || response.ok !== true) {
    setStatus(messageFromError(response?.error) ?? "Failed to load extension state.");
    return;
  }

  const selectorRules = selectorController.normalizeSelectorRules(response.selectorRules);
  selectorController.renderSelectorRules(selectorRules);
  setCollectedLinksState(response.collectedLinks);
  setQueueItemsState(response.queueItems);
  setQueueRuntimeState(response.queueRuntime);
  setProviderDiagnosticsState(response.providerDiagnostics);
  selectorController.setSelectorRulesDirty(false);
  setStatus("Ready.");
}

async function collectLinks() {
  if (panelState.selectorRulesDirty) {
    setStatus("Save selector rules before collecting links.");
    return;
  }

  collectButton.disabled = true;

  try {
    const activeTab = await getActiveTabAction();
    if (!activeTab || typeof activeTab.url !== "string") {
      setStatus("No active tab found.");
      return;
    }

    if (!isHttpUrl(activeTab.url)) {
      setStatus("Collect Links only works on http(s) pages.");
      return;
    }

    setStatus("Checking host permission...");
    const permissionResult = await ensureHostPermissionAction(activeTab.url);
    if (!permissionResult.granted) {
      setStatus("Permission was not granted for this site.");
      return;
    }

    setStatus("Collecting links...");
    const response = await collectLinksAction();

    if (!response || response.ok !== true) {
      const errorCode = response?.error?.code;
      if (errorCode === ERROR_CODES.MISSING_HOST_PERMISSION) {
        setStatus("Host permission is required to collect links.");
      } else {
        setStatus(messageFromError(response?.error) ?? "Collect Links failed.");
      }
      return;
    }

    if (response.providerDiagnostics) {
      setProviderDiagnosticsState(response.providerDiagnostics);
    }
    setCollectedLinksState(response.links);
    setStatus(`Collected ${panelState.collectedLinks.length} link(s).`);
  } catch (error) {
    console.error("[zotero-archivist] Collect Links failed.", error);
    setStatus("Collect Links failed.");
  } finally {
    collectButton.disabled = false;
  }
}

function setCollectedLinksState(links) {
  panelStore.setCollectedLinks(links);
  renderLinks(panelState.collectedLinks);
}

function setQueueItemsState(queueItems) {
  panelStore.setQueueItems(queueItems);
  renderQueue(panelState.queueItems);
  renderQueueRuntimeStatus(panelState.queueRuntime);
}

function setQueueRuntimeState(queueRuntime) {
  panelStore.setQueueRuntime(queueRuntime);
  renderQueueRuntimeStatus(panelState.queueRuntime);
  updateQueueActionState();
}

function setProviderDiagnosticsState(providerDiagnostics) {
  panelStore.setProviderDiagnostics(providerDiagnostics);
  renderIntegrationState();
}

function handleStorageChange(changes, areaName) {
  if (areaName !== "local") {
    return;
  }

  const queueItemsChange = changes[STORAGE_KEYS.QUEUE_ITEMS];
  if (queueItemsChange) {
    setQueueItemsState(queueItemsChange.newValue);
  }

  const queueRuntimeChange = changes[STORAGE_KEYS.QUEUE_RUNTIME];
  if (queueRuntimeChange) {
    setQueueRuntimeState(queueRuntimeChange.newValue);
  }

  const providerDiagnosticsChange = changes[STORAGE_KEYS.PROVIDER_DIAGNOSTICS];
  if (providerDiagnosticsChange) {
    setProviderDiagnosticsState(providerDiagnosticsChange.newValue);
  }
}

function renderLinks(links) {
  renderLinksView({
    links,
    resultsFilterQuery: panelState.resultsFilterQuery,
    resultsTitleEl,
    resultsSummaryEl,
    resultsListEl,
    resultsFilterInput,
    selectAllLinksButton,
    deselectAllLinksButton,
    invertLinksButton,
    clearAllLinksButton,
    updateQueueActionState
  });
}

function renderQueue(queueItems) {
  renderQueueView({
    queueItems,
    queueTitleEl,
    queueSummaryEl,
    queueListEl,
    updateQueueActionState
  });
}

function renderIntegrationState() {
  renderIntegrationStateView({
    providerDiagnosticsState: panelState.providerDiagnostics,
    refreshDiagnosticsButton,
    integrationModeEl,
    integrationUpdatedAtEl,
    integrationBridgeRowEl,
    integrationBridgeStatusEl,
    integrationConnectorRowEl,
    integrationConnectorStatusEl,
    integrationZoteroRowEl,
    integrationZoteroStatusEl,
    integrationErrorEl,
    integrationBusy: panelStore.isIntegrationBusy()
  });
}

function renderQueueRuntimeStatus(queueRuntime) {
  renderQueueRuntimeStatusView({
    queueRuntime,
    queueRuntimeStatusEl
  });
}

function updateQueueActionState() {
  const selectedCount = panelState.collectedLinks.filter((link) => link.selected !== false).length;
  const queueBusy = isQueueBusy();
  const queueCounts = getQueueItemCounts(panelState.queueItems);
  const hasActiveQueueItem = typeof panelState.queueRuntime.activeQueueItemId === "string";

  addSelectedToQueueButton.disabled = queueBusy || selectedCount === 0;
  clearQueueButton.disabled =
    queueBusy || panelState.queueItems.length === 0 || panelState.queueRuntime.status === "running";
  startQueueButton.disabled =
    queueBusy || panelState.queueRuntime.status !== "idle" || queueCounts.pendingCount === 0;
  pauseQueueButton.disabled = queueBusy || panelState.queueRuntime.status !== "running";
  resumeQueueButton.disabled =
    queueBusy ||
    panelState.queueRuntime.status !== "paused" ||
    (queueCounts.pendingCount === 0 && !hasActiveQueueItem);
  stopQueueButton.disabled = queueBusy || panelState.queueRuntime.status === "idle";
  retryFailedQueueButton.disabled =
    queueBusy ||
    panelState.queueRuntime.status === "running" ||
    queueCounts.retriableCount === 0;
}

function isQueueBusy() {
  return panelStore.isQueueBusy();
}

function setStatus(message) {
  statusEl.textContent = message;
}

function messageFromError(error) {
  if (!error || typeof error !== "object") {
    return null;
  }

  if (typeof error.message === "string" && error.message.length > 0) {
    return error.message;
  }

  return null;
}

async function refreshIntegrationDiagnostics() {
  panelStore.setIntegrationInProgress(true);
  renderIntegrationState();

  try {
    const response = await getPanelStateAction();
    if (!response || response.ok !== true) {
      setStatus(messageFromError(response?.error) ?? "Failed to refresh integration diagnostics.");
      return;
    }

    setProviderDiagnosticsState(response.providerDiagnostics);
    setStatus("Integration diagnostics refreshed.");
  } catch (error) {
    console.error("[zotero-archivist] Failed to refresh integration diagnostics.", error);
    setStatus("Failed to refresh integration diagnostics.");
  } finally {
    panelStore.setIntegrationInProgress(false);
    renderIntegrationState();
  }
}
