import {
  ERROR_CODES,
  STORAGE_KEYS,
  isHttpUrl
} from "../shared/protocol.js";
import { getQueueItemCounts, normalizeQueueSettings } from "../shared/state.js";
import {
  authorQueueFromSelectionAction,
  clearArchivedQueueAction,
  clearQueueAction,
  collectLinksAction,
  ensureHostPermissionAction,
  ensureHostPermissionsForUrlsAction,
  getActiveTabAction,
  getCurrentWindowIdAction,
  getPanelStateAction,
  queueLifecycleAction,
  setCollectedLinksAction,
  setQueueSettingsAction,
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
const workspaceEl = document.getElementById("workspace");
const workspaceResizerEl = document.getElementById("workspace-resizer");
const resultsSectionEl = document.getElementById("results-section");
const queueSectionEl = document.getElementById("queue-section");
const queueToggleButton = document.getElementById("queue-toggle-button");
const queueBodyEl = document.getElementById("queue-body");
const queueTitleEl = document.getElementById("queue-title");
const queueSummaryEl = document.getElementById("queue-summary");
const queueRuntimeStatusEl = document.getElementById("queue-runtime-status");
const queueListEl = document.getElementById("queue-list");
const addSelectedToQueueButton = document.getElementById("add-selected-to-queue-button");
const clearQueueButton = document.getElementById("clear-queue-button");
const clearArchivedQueueButton = document.getElementById("clear-archived-queue-button");
const reverseQueueButton = document.getElementById("reverse-queue-button");
const startQueueButton = document.getElementById("start-queue-button");
const pauseQueueButton = document.getElementById("pause-queue-button");
const resumeQueueButton = document.getElementById("resume-queue-button");
const stopQueueButton = document.getElementById("stop-queue-button");
const retryFailedQueueButton = document.getElementById("retry-failed-queue-button");
const queueDelaySecondsInput = document.getElementById("queue-delay-seconds-input");
const queueJitterSecondsInput = document.getElementById("queue-jitter-seconds-input");
const saveQueueSettingsButton = document.getElementById("save-queue-settings-button");
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

const QUEUE_SETTINGS_MILLISECONDS_PER_SECOND = 1000;
const DEFAULT_QUEUE_RESIZED_HEIGHT_PX = 300;
const QUEUE_RESIZE_STEP_PX = 24;
const QUEUE_RESIZE_ACCELERATED_STEP_PX = 64;
const QUEUE_MIN_BODY_FALLBACK_PX = 220;
const RESULTS_MIN_SECTION_FALLBACK_PX = 96;

const panelStore = createPanelStore(normalizeFilterQueryValue(resultsFilterInput.value));
const panelState = panelStore.state;
let queueSettingsSaveInProgress = false;
let queueResizedHeightPx = DEFAULT_QUEUE_RESIZED_HEIGHT_PX;
let activeResizePointerId = null;
let resizeStartY = 0;
let resizeStartHeight = 0;

const queueController = createQueueController({
  panelStore,
  getCollectedLinks: () => panelState.collectedLinks,
  getQueueItems: () => panelState.queueItems,
  getQueueRuntime: () => panelState.queueRuntime,
  getQueueRuntimeContext,
  queueLifecycleActionImpl: queueLifecycleAction,
  ensureHostPermissionsForUrlsActionImpl: ensureHostPermissionsForUrlsAction,
  authorQueueFromSelectionActionImpl: authorQueueFromSelectionAction,
  clearQueueActionImpl: clearQueueAction,
  clearArchivedQueueActionImpl: clearArchivedQueueAction,
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

clearArchivedQueueButton.addEventListener("click", () => {
  void queueController.clearArchivedQueueItems();
});

reverseQueueButton.addEventListener("click", () => {
  void queueController.reverseQueueItems();
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

queueListEl.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const removeButton = target.closest(".queue-item-remove-button");
  if (!(removeButton instanceof HTMLButtonElement)) {
    return;
  }

  const queueItemId = removeButton.dataset.queueItemId;
  void queueController.removeQueueItem(queueItemId);
});

saveQueueSettingsButton.addEventListener("click", () => {
  void saveQueueSettings();
});

refreshDiagnosticsButton.addEventListener("click", () => {
  void refreshIntegrationDiagnostics();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  handleStorageChange(changes, areaName);
});

initializeSectionToggle(selectorsToggleButton, selectorsBodyEl);
initializeSectionToggle(resultsToggleButton, resultsBodyEl);
initializeSectionToggle(queueToggleButton, queueBodyEl);
initializeWorkspaceResizer();
renderIntegrationState();
updateQueueActionState();
updateQueueSettingsActionState();

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
  setQueueSettingsState(response.queueSettings);
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
    console.error("[webpage-archivist] Collect Links failed.", error);
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

function setQueueSettingsState(queueSettings) {
  panelStore.setQueueSettings(queueSettings);
  renderQueueSettingsForm(panelState.queueSettings);
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

  const queueSettingsChange = changes[STORAGE_KEYS.QUEUE_SETTINGS];
  if (queueSettingsChange) {
    setQueueSettingsState(queueSettingsChange.newValue);
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
  clearArchivedQueueButton.disabled =
    queueBusy || panelState.queueRuntime.status === "running" || queueCounts.archivedCount === 0;
  reverseQueueButton.disabled =
    queueBusy || panelState.queueRuntime.status === "running" || panelState.queueItems.length < 2;
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

  const queueItemRemoveDisabled = queueBusy || panelState.queueRuntime.status === "running";
  for (const removeButton of queueListEl.querySelectorAll(".queue-item-remove-button")) {
    if (removeButton instanceof HTMLButtonElement) {
      removeButton.disabled = queueItemRemoveDisabled;
    }
  }
}

function isQueueBusy() {
  return panelStore.isQueueBusy();
}

function setStatus(message) {
  statusEl.textContent = message;
}

function initializeWorkspaceResizer() {
  if (
    !(workspaceEl instanceof HTMLElement) ||
    !(workspaceResizerEl instanceof HTMLElement) ||
    !(resultsSectionEl instanceof HTMLElement) ||
    !(queueSectionEl instanceof HTMLElement) ||
    !(queueToggleButton instanceof HTMLButtonElement) ||
    !(queueBodyEl instanceof HTMLElement)
  ) {
    return;
  }

  syncQueueResizableState();
  window.addEventListener("resize", syncQueueResizableState);
  queueToggleButton.addEventListener("click", syncQueueResizableState);

  workspaceResizerEl.addEventListener("pointerdown", handleWorkspaceResizerPointerDown);
  workspaceResizerEl.addEventListener("keydown", handleWorkspaceResizerKeyDown);
}

function syncQueueResizableState() {
  if (!(queueSectionEl instanceof HTMLElement) || !(queueBodyEl instanceof HTMLElement)) {
    return;
  }

  const queueExpanded = !queueBodyEl.hidden;
  queueSectionEl.classList.toggle("queue-resizable", queueExpanded);
  workspaceResizerEl.hidden = !queueExpanded;
  workspaceResizerEl.setAttribute("aria-hidden", queueExpanded ? "false" : "true");

  if (!queueExpanded) {
    queueSectionEl.style.removeProperty("--queue-resized-height");
    return;
  }

  queueResizedHeightPx = clampQueueSectionHeight(queueResizedHeightPx || DEFAULT_QUEUE_RESIZED_HEIGHT_PX);
  applyQueueSectionHeight(queueResizedHeightPx);
}

function handleWorkspaceResizerPointerDown(event) {
  if (event.button !== 0 || !(queueSectionEl instanceof HTMLElement)) {
    return;
  }

  event.preventDefault();
  const pointerTarget = event.currentTarget;
  if (!(pointerTarget instanceof HTMLElement)) {
    return;
  }

  pointerTarget.setPointerCapture(event.pointerId);
  activeResizePointerId = event.pointerId;
  resizeStartY = event.clientY;
  resizeStartHeight = queueSectionEl.getBoundingClientRect().height;
  pointerTarget.classList.add("is-dragging");
  pointerTarget.addEventListener("pointermove", handleWorkspaceResizerPointerMove);
  pointerTarget.addEventListener("pointerup", handleWorkspaceResizerPointerDone);
  pointerTarget.addEventListener("pointercancel", handleWorkspaceResizerPointerDone);
}

function handleWorkspaceResizerPointerMove(event) {
  if (event.pointerId !== activeResizePointerId) {
    return;
  }

  const deltaY = resizeStartY - event.clientY;
  const nextHeight = clampQueueSectionHeight(resizeStartHeight + deltaY);
  queueResizedHeightPx = nextHeight;
  applyQueueSectionHeight(nextHeight);
}

function handleWorkspaceResizerPointerDone(event) {
  if (event.pointerId !== activeResizePointerId) {
    return;
  }

  const pointerTarget = event.currentTarget;
  if (!(pointerTarget instanceof HTMLElement)) {
    return;
  }

  activeResizePointerId = null;
  pointerTarget.classList.remove("is-dragging");
  pointerTarget.removeEventListener("pointermove", handleWorkspaceResizerPointerMove);
  pointerTarget.removeEventListener("pointerup", handleWorkspaceResizerPointerDone);
  pointerTarget.removeEventListener("pointercancel", handleWorkspaceResizerPointerDone);
}

function handleWorkspaceResizerKeyDown(event) {
  if (queueBodyEl.hidden) {
    return;
  }

  const step = event.shiftKey ? QUEUE_RESIZE_ACCELERATED_STEP_PX : QUEUE_RESIZE_STEP_PX;
  if (event.key === "ArrowUp") {
    event.preventDefault();
    queueResizedHeightPx = clampQueueSectionHeight(queueResizedHeightPx + step);
    applyQueueSectionHeight(queueResizedHeightPx);
    return;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    queueResizedHeightPx = clampQueueSectionHeight(queueResizedHeightPx - step);
    applyQueueSectionHeight(queueResizedHeightPx);
  }
}

function applyQueueSectionHeight(heightPx) {
  if (!(queueSectionEl instanceof HTMLElement)) {
    return;
  }
  queueSectionEl.style.setProperty("--queue-resized-height", `${Math.round(heightPx)}px`);
}

function clampQueueSectionHeight(proposedHeightPx) {
  const numericHeight = Number.isFinite(proposedHeightPx) ? proposedHeightPx : DEFAULT_QUEUE_RESIZED_HEIGHT_PX;
  const queueMinHeight = readCssPixels("--queue-min-height", QUEUE_MIN_BODY_FALLBACK_PX);
  const resultsMinHeight = resultsBodyEl.hidden
    ? 0
    : readCssPixels("--results-min-height", RESULTS_MIN_SECTION_FALLBACK_PX);
  const workspaceResizerHeight = workspaceResizerEl instanceof HTMLElement
    ? workspaceResizerEl.getBoundingClientRect().height
    : 0;
  const workspaceHeight = workspaceEl instanceof HTMLElement ? workspaceEl.getBoundingClientRect().height : 0;
  const queueHeaderHeight = queueSectionEl instanceof HTMLElement
    ? queueSectionEl.querySelector(".section-header")?.getBoundingClientRect().height ?? 0
    : 0;

  const minQueueSectionHeight = queueHeaderHeight + queueMinHeight;
  const maxQueueSectionHeight = Math.max(
    minQueueSectionHeight,
    workspaceHeight - resultsMinHeight - workspaceResizerHeight
  );
  return Math.max(minQueueSectionHeight, Math.min(maxQueueSectionHeight, numericHeight));
}

function readCssPixels(variableName, fallback) {
  try {
    const value = getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch (_error) {
    return fallback;
  }
}

function renderQueueSettingsForm(queueSettings) {
  const normalizedQueueSettings = normalizeQueueSettings(queueSettings);
  queueDelaySecondsInput.value = formatSecondsInput(normalizedQueueSettings.interItemDelayMs);
  queueJitterSecondsInput.value = formatSecondsInput(normalizedQueueSettings.interItemDelayJitterMs);
}

function updateQueueSettingsActionState() {
  saveQueueSettingsButton.disabled = queueSettingsSaveInProgress;
}

function setQueueSettingsSaveInProgress(value) {
  queueSettingsSaveInProgress = Boolean(value);
  updateQueueSettingsActionState();
}

async function saveQueueSettings() {
  const normalizedQueueSettings = readQueueSettingsFromInputs();
  if (!normalizedQueueSettings) {
    return;
  }

  setQueueSettingsSaveInProgress(true);
  try {
    const response = await setQueueSettingsAction(normalizedQueueSettings);
    if (!response || response.ok !== true) {
      setStatus(messageFromError(response?.error) ?? "Failed to save queue settings.");
      return;
    }

    const savedQueueSettings = normalizeQueueSettings(response.queueSettings);
    setQueueSettingsState(savedQueueSettings);
    setStatus(
      `Queue delay set to ${formatSecondsLabel(savedQueueSettings.interItemDelayMs)} +/- ${formatSecondsLabel(savedQueueSettings.interItemDelayJitterMs)}.`
    );
  } catch (error) {
    console.error("[webpage-archivist] Failed to save queue settings.", error);
    setStatus("Failed to save queue settings.");
  } finally {
    setQueueSettingsSaveInProgress(false);
  }
}

function readQueueSettingsFromInputs() {
  const delaySeconds = Number.parseFloat(queueDelaySecondsInput.value);
  const jitterSeconds = Number.parseFloat(queueJitterSecondsInput.value);

  if (!Number.isFinite(delaySeconds) || delaySeconds < 0) {
    setStatus("Queue delay must be a number >= 0.");
    return null;
  }

  if (!Number.isFinite(jitterSeconds) || jitterSeconds < 0) {
    setStatus("Queue jitter must be a number >= 0.");
    return null;
  }

  return normalizeQueueSettings({
    interItemDelayMs: Math.round(delaySeconds * QUEUE_SETTINGS_MILLISECONDS_PER_SECOND),
    interItemDelayJitterMs: Math.round(jitterSeconds * QUEUE_SETTINGS_MILLISECONDS_PER_SECOND)
  });
}

function formatSecondsInput(milliseconds) {
  const seconds = milliseconds / QUEUE_SETTINGS_MILLISECONDS_PER_SECOND;
  if (Number.isInteger(seconds)) {
    return String(seconds);
  }
  return String(Number(seconds.toFixed(3)));
}

function formatSecondsLabel(milliseconds) {
  return `${formatSecondsInput(milliseconds)}s`;
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

async function getQueueRuntimeContext() {
  const controllerWindowId = await getCurrentWindowIdAction();
  if (!Number.isInteger(controllerWindowId)) {
    return null;
  }

  return {
    controllerWindowId
  };
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
    console.error("[webpage-archivist] Failed to refresh integration diagnostics.", error);
    setStatus("Failed to refresh integration diagnostics.");
  } finally {
    panelStore.setIntegrationInProgress(false);
    renderIntegrationState();
  }
}
