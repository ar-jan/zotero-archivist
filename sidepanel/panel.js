import {
  ERROR_CODES,
  MESSAGE_TYPES,
  STORAGE_KEYS,
  isHttpUrl,
  sanitizeSelectorRules
} from "../shared/protocol.js";
import { getQueueItemCounts } from "../shared/state.js";
import {
  authorQueueFromSelectionAction,
  clearQueueAction,
  collectLinksAction,
  ensureHostPermissionAction,
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
const integrationBridgeRowEl = document.getElementById("integration-bridge-row");
const integrationBridgeStatusEl = document.getElementById("integration-bridge-status");
const integrationConnectorRowEl = document.getElementById("integration-connector-row");
const integrationConnectorStatusEl = document.getElementById("integration-connector-status");
const integrationZoteroRowEl = document.getElementById("integration-zotero-row");
const integrationZoteroStatusEl = document.getElementById("integration-zotero-status");
const integrationErrorEl = document.getElementById("integration-error");

const panelStore = createPanelStore(normalizeFilterQueryValue(resultsFilterInput.value));
const panelState = panelStore.state;

collectButton.addEventListener("click", () => {
  void collectLinks();
});

addRuleButton.addEventListener("click", () => {
  addSelectorRule();
});

saveRulesButton.addEventListener("click", () => {
  void saveSelectorRules();
});

selectorRulesListEl.addEventListener("click", (event) => {
  handleSelectorRuleListClick(event);
});

selectorRulesListEl.addEventListener("input", () => {
  markSelectorRulesDirty();
});

selectorRulesListEl.addEventListener("change", () => {
  markSelectorRulesDirty();
});

resultsListEl.addEventListener("change", (event) => {
  void handleResultsListChange(event);
});

selectAllLinksButton.addEventListener("click", () => {
  void setFilteredLinksSelectedState(true);
});

deselectAllLinksButton.addEventListener("click", () => {
  void setFilteredLinksSelectedState(false);
});

invertLinksButton.addEventListener("click", () => {
  void invertFilteredLinkSelection();
});

clearAllLinksButton.addEventListener("click", () => {
  void clearCollectedLinks();
});

resultsFilterInput.addEventListener("input", () => {
  panelState.resultsFilterQuery = normalizeFilterQueryValue(resultsFilterInput.value);
  renderLinks(panelState.collectedLinks);
});

addSelectedToQueueButton.addEventListener("click", () => {
  void addSelectedLinksToQueue();
});

clearQueueButton.addEventListener("click", () => {
  void clearQueueItems();
});

startQueueButton.addEventListener("click", () => {
  void startQueueProcessing();
});

pauseQueueButton.addEventListener("click", () => {
  void pauseQueueProcessing();
});

resumeQueueButton.addEventListener("click", () => {
  void resumeQueueProcessing();
});

stopQueueButton.addEventListener("click", () => {
  void stopQueueProcessing();
});

retryFailedQueueButton.addEventListener("click", () => {
  void retryFailedQueueItems();
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

  const selectorRules = normalizeSelectorRules(response.selectorRules);
  renderSelectorRules(selectorRules);
  setCollectedLinksState(response.collectedLinks);
  setQueueItemsState(response.queueItems);
  setQueueRuntimeState(response.queueRuntime);
  setProviderDiagnosticsState(response.providerDiagnostics);
  setSelectorRulesDirty(false);
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

function addSelectorRule() {
  const draftRules = readSelectorRulesFromForm();
  draftRules.push(createNewSelectorRule());
  renderSelectorRules(draftRules);
  setSelectorRulesDirty(true);
  setStatus("Added selector rule. Save rules to apply it.");
}

async function saveSelectorRules() {
  const draftRules = readSelectorRulesFromForm();
  const validationError = validateSelectorRules(draftRules);
  if (validationError) {
    setStatus(validationError);
    return;
  }

  saveRulesButton.disabled = true;
  try {
    const response = await setSelectorRulesAction(draftRules);

    if (!response || response.ok !== true) {
      setStatus(messageFromError(response?.error) ?? "Failed to save selector rules.");
      return;
    }

    const persistedRules = normalizeSelectorRules(response.selectorRules);
    renderSelectorRules(persistedRules);
    setSelectorRulesDirty(false);
    setStatus(`Saved ${persistedRules.length} selector rule(s).`);
  } catch (error) {
    console.error("[zotero-archivist] Failed to save selector rules.", error);
    setStatus("Failed to save selector rules.");
  } finally {
    saveRulesButton.disabled = false;
  }
}

function handleSelectorRuleListClick(event) {
  if (!(event.target instanceof Element)) {
    return;
  }

  const deleteButton = event.target.closest(".rule-delete-button");
  if (!deleteButton) {
    return;
  }

  const currentItems = selectorRulesListEl.querySelectorAll(".selector-rule-item");
  if (currentItems.length <= 1) {
    setStatus("At least one selector rule is required.");
    return;
  }

  const item = deleteButton.closest(".selector-rule-item");
  if (!item) {
    return;
  }

  item.remove();
  setSelectorRulesDirty(true);
  setStatus("Removed selector rule. Save rules to apply changes.");
}

function renderSelectorRules(rules) {
  selectorRulesListEl.textContent = "";

  for (const rule of rules) {
    selectorRulesListEl.append(createSelectorRuleItem(rule));
  }

  updateRulesSummary(rules.length);
}

function createSelectorRuleItem(rule) {
  const item = document.createElement("li");
  item.className = "selector-rule-item";
  item.dataset.ruleId = rule.id;

  const headerRow = document.createElement("div");
  headerRow.className = "rule-header-row";

  const headingGroup = document.createElement("div");
  headingGroup.className = "rule-heading-group";

  const headingButton = document.createElement("button");
  headingButton.className = "rule-heading-toggle";
  headingButton.type = "button";
  headingButton.textContent = formatRuleHeading(rule.name ?? "", rule.id);
  headingButton.setAttribute("aria-expanded", "false");

  const toggleLabel = document.createElement("label");
  toggleLabel.className = "rule-toggle";
  const toggleInput = document.createElement("input");
  toggleInput.className = "rule-enabled-input";
  toggleInput.type = "checkbox";
  toggleInput.checked = rule.enabled !== false;
  toggleLabel.append(toggleInput, document.createTextNode("Enabled"));
  headingGroup.append(headingButton, toggleLabel);

  const deleteButton = document.createElement("button");
  deleteButton.className = "rule-delete-button";
  deleteButton.type = "button";
  deleteButton.textContent = "Delete";

  headerRow.append(headingGroup, deleteButton);

  const fieldsId = `rule-fields-${rule.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const nameField = createRuleField("Name", "rule-name-input", rule.name ?? "", "Readable label");
  const nameInput = nameField.querySelector(".rule-name-input");
  if (nameInput instanceof HTMLInputElement) {
    nameInput.addEventListener("input", () => {
      headingButton.textContent = formatRuleHeading(nameInput.value, rule.id);
    });
  }

  const fields = document.createElement("div");
  fields.className = "rule-fields rule-collapsible-fields";
  fields.id = fieldsId;
  fields.hidden = true;
  headingButton.setAttribute("aria-controls", fieldsId);
  headingButton.addEventListener("click", () => {
    const nextExpanded = headingButton.getAttribute("aria-expanded") !== "true";
    headingButton.setAttribute("aria-expanded", nextExpanded ? "true" : "false");
    fields.hidden = !nextExpanded;
  });

  fields.append(
    nameField,
    createRuleField("CSS selector", "rule-selector-input", rule.cssSelector ?? "", "a[href]"),
    createRuleField("URL attribute", "rule-attribute-input", rule.urlAttribute ?? "href", "href"),
    createRuleField("Include pattern", "rule-include-input", rule.includePattern ?? "", "optional"),
    createRuleField("Exclude pattern", "rule-exclude-input", rule.excludePattern ?? "", "optional")
  );

  item.append(headerRow, fields);
  return item;
}

function createRuleField(labelText, inputClassName, value, placeholder) {
  const wrapper = document.createElement("label");
  wrapper.className = "rule-field";

  const label = document.createElement("span");
  label.className = "rule-field-label";
  label.textContent = labelText;

  const input = document.createElement("input");
  input.className = `rule-field-input ${inputClassName}`;
  input.type = "text";
  input.value = value;
  input.placeholder = placeholder;

  wrapper.append(label, input);
  return wrapper;
}

function formatRuleHeading(name, fallbackId) {
  if (typeof name === "string" && name.trim().length > 0) {
    return name.trim();
  }

  if (typeof fallbackId === "string" && fallbackId.trim().length > 0) {
    return fallbackId.trim();
  }

  return "Unnamed rule";
}

function readSelectorRulesFromForm() {
  const items = selectorRulesListEl.querySelectorAll(".selector-rule-item");
  const rules = [];

  for (const item of items) {
    const ruleId = readRuleId(item);
    const name = readInputValue(item, ".rule-name-input");
    const cssSelector = readInputValue(item, ".rule-selector-input");
    const urlAttribute = readInputValue(item, ".rule-attribute-input");
    const includePattern = readInputValue(item, ".rule-include-input");
    const excludePattern = readInputValue(item, ".rule-exclude-input");
    const enabledInput = item.querySelector(".rule-enabled-input");

    const rule = {
      id: ruleId,
      name: name || ruleId,
      cssSelector,
      urlAttribute: urlAttribute || "href",
      enabled: enabledInput?.checked !== false
    };

    if (includePattern.length > 0) {
      rule.includePattern = includePattern;
    }

    if (excludePattern.length > 0) {
      rule.excludePattern = excludePattern;
    }

    rules.push(rule);
  }

  return rules;
}

function normalizeSelectorRules(rules) {
  return sanitizeSelectorRules(rules);
}

function validateSelectorRules(rules) {
  if (!Array.isArray(rules) || rules.length === 0) {
    return "At least one selector rule is required.";
  }

  const seenIds = new Set();
  for (let i = 0; i < rules.length; i += 1) {
    const rule = rules[i];
    const ruleNumber = i + 1;

    if (typeof rule.id !== "string" || rule.id.trim().length === 0) {
      return `Rule ${ruleNumber} is missing an id.`;
    }

    if (seenIds.has(rule.id)) {
      return `Rule ${ruleNumber} has a duplicate id.`;
    }
    seenIds.add(rule.id);

    if (typeof rule.cssSelector !== "string" || rule.cssSelector.trim().length === 0) {
      return `Rule ${ruleNumber} must include a CSS selector.`;
    }
  }

  return null;
}

function markSelectorRulesDirty() {
  if (!panelState.selectorRulesDirty) {
    panelStore.setSelectorRulesDirty(true);
  }
  updateRulesSummary(getDraftSelectorRuleCount());
}

function setSelectorRulesDirty(isDirty) {
  panelStore.setSelectorRulesDirty(isDirty);
  updateRulesSummary(getDraftSelectorRuleCount());
}

function updateRulesSummary(ruleCount) {
  const dirtySuffix = panelState.selectorRulesDirty ? " (unsaved changes)" : "";
  rulesSummaryEl.textContent = `${ruleCount} selector rule(s) configured${dirtySuffix}`;
}

function getDraftSelectorRuleCount() {
  return selectorRulesListEl.querySelectorAll(".selector-rule-item").length;
}

function createNewSelectorRule() {
  return {
    id: nextRuleId(),
    name: "Custom rule",
    cssSelector: "a[href]",
    urlAttribute: "href",
    enabled: true
  };
}

function nextRuleId() {
  return panelStore.nextRuleId();
}

function readRuleId(item) {
  const existing = typeof item.dataset.ruleId === "string" ? item.dataset.ruleId.trim() : "";
  if (existing.length > 0) {
    return existing;
  }

  const createdId = nextRuleId();
  item.dataset.ruleId = createdId;
  return createdId;
}

function readInputValue(item, selector) {
  const input = item.querySelector(selector);
  if (!input || typeof input.value !== "string") {
    return "";
  }

  return input.value.trim();
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

async function startQueueProcessing() {
  await runQueueLifecycleAction({
    messageType: MESSAGE_TYPES.START_QUEUE,
    fallbackErrorMessage: "Failed to start queue.",
    successStatusMessage: "Queue started."
  });
}

async function pauseQueueProcessing() {
  await runQueueLifecycleAction({
    messageType: MESSAGE_TYPES.PAUSE_QUEUE,
    fallbackErrorMessage: "Failed to pause queue.",
    successStatusMessage: "Queue paused."
  });
}

async function resumeQueueProcessing() {
  await runQueueLifecycleAction({
    messageType: MESSAGE_TYPES.RESUME_QUEUE,
    fallbackErrorMessage: "Failed to resume queue.",
    successStatusMessage: "Queue resumed."
  });
}

async function stopQueueProcessing() {
  await runQueueLifecycleAction({
    messageType: MESSAGE_TYPES.STOP_QUEUE,
    fallbackErrorMessage: "Failed to stop queue.",
    successStatusMessage: "Queue stopped."
  });
}

async function retryFailedQueueItems() {
  await runQueueLifecycleAction({
    messageType: MESSAGE_TYPES.RETRY_FAILED_QUEUE,
    fallbackErrorMessage: "Failed to retry queue items.",
    successStatusMessage: "Retry queued for failed items."
  });
}

async function runQueueLifecycleAction({
  messageType,
  fallbackErrorMessage,
  successStatusMessage
}) {
  panelStore.setQueueLifecycleInProgress(true);
  updateQueueActionState();

  try {
    const response = await queueLifecycleAction(messageType);

    if (!response || response.ok !== true) {
      setStatus(messageFromError(response?.error) ?? fallbackErrorMessage);
      return;
    }

    if (Array.isArray(response.queueItems)) {
      setQueueItemsState(response.queueItems);
    }
    if (response.queueRuntime) {
      setQueueRuntimeState(response.queueRuntime);
    }

    if (
      messageType === MESSAGE_TYPES.RETRY_FAILED_QUEUE &&
      Number.isFinite(response.retriedCount) &&
      response.retriedCount > 0
    ) {
      setStatus(`Queued ${response.retriedCount} item(s) for retry.`);
      return;
    }

    setStatus(successStatusMessage);
  } catch (error) {
    console.error("[zotero-archivist] Queue lifecycle action failed.", {
      messageType,
      error
    });
    setStatus(fallbackErrorMessage);
  } finally {
    panelStore.setQueueLifecycleInProgress(false);
    updateQueueActionState();
  }
}

async function addSelectedLinksToQueue() {
  const selectedLinks = panelState.collectedLinks.filter((link) => link.selected !== false);
  if (selectedLinks.length === 0) {
    setStatus("Select at least one link to add to queue.");
    return;
  }

  panelStore.setQueueAuthoringInProgress(true);
  updateQueueActionState();

  try {
    const response = await authorQueueFromSelectionAction(selectedLinks);

    if (!response || response.ok !== true) {
      setStatus(messageFromError(response?.error) ?? "Failed to add selected links to queue.");
      return;
    }

    setQueueItemsState(response.queueItems);
    const addedCount = Number.isFinite(response.addedCount) ? response.addedCount : 0;
    const skippedCount = Number.isFinite(response.skippedCount) ? response.skippedCount : 0;

    if (addedCount === 0 && skippedCount > 0) {
      setStatus("Selected links are already in queue.");
      return;
    }

    if (skippedCount > 0) {
      setStatus(`Added ${addedCount} link(s) to queue (${skippedCount} already queued).`);
      return;
    }

    setStatus(`Added ${addedCount} link(s) to queue.`);
  } catch (error) {
    console.error("[zotero-archivist] Failed to add selected links to queue.", error);
    setStatus("Failed to add selected links to queue.");
  } finally {
    panelStore.setQueueAuthoringInProgress(false);
    updateQueueActionState();
  }
}

async function clearQueueItems() {
  if (panelState.queueItems.length === 0) {
    setStatus("Queue is already empty.");
    return;
  }

  panelStore.setQueueClearingInProgress(true);
  updateQueueActionState();

  try {
    const response = await clearQueueAction();

    if (!response || response.ok !== true) {
      setStatus(messageFromError(response?.error) ?? "Failed to clear queue.");
      return;
    }

    setQueueItemsState(response.queueItems);
    if (response.queueRuntime) {
      setQueueRuntimeState(response.queueRuntime);
    }
    setStatus("Cleared queue.");
  } catch (error) {
    console.error("[zotero-archivist] Failed to clear queue.", error);
    setStatus("Failed to clear queue.");
  } finally {
    panelStore.setQueueClearingInProgress(false);
    updateQueueActionState();
  }
}

async function handleResultsListChange(event) {
  if (!(event.target instanceof HTMLInputElement)) {
    return;
  }

  if (!event.target.classList.contains("result-selected-input")) {
    return;
  }

  const linkId = typeof event.target.dataset.linkId === "string" ? event.target.dataset.linkId : "";
  if (linkId.length === 0) {
    return;
  }

  const nextSelected = event.target.checked;
  let changed = false;
  const nextLinks = panelState.collectedLinks.map((link) => {
    if (link.id !== linkId) {
      return link;
    }

    const currentSelected = link.selected !== false;
    if (currentSelected === nextSelected) {
      return link;
    }

    changed = true;
    return {
      ...link,
      selected: nextSelected
    };
  });

  if (!changed) {
    return;
  }

  setCollectedLinksState(nextLinks);
  const persisted = await persistCollectedLinks();
  if (persisted) {
    setStatus(`${nextSelected ? "Selected" : "Cleared"} 1 link.`);
  }
}

async function setFilteredLinksSelectedState(nextSelectedState) {
  const filteredLinks = getFilteredLinks(panelState.collectedLinks, panelState.resultsFilterQuery);
  if (filteredLinks.length === 0) {
    setStatus("No links match the current filter.");
    return;
  }

  const filteredIds = new Set(filteredLinks.map((link) => link.id));
  let changedCount = 0;
  const nextLinks = panelState.collectedLinks.map((link) => {
    if (!filteredIds.has(link.id)) {
      return link;
    }

    const currentSelected = link.selected !== false;
    if (currentSelected === nextSelectedState) {
      return link;
    }

    changedCount += 1;
    return {
      ...link,
      selected: nextSelectedState
    };
  });

  if (changedCount === 0) {
    setStatus(
      nextSelectedState
        ? "Filtered links are already selected."
        : "Filtered links are already deselected."
    );
    return;
  }

  setCollectedLinksState(nextLinks);
  const persisted = await persistCollectedLinks();
  if (persisted) {
    setStatus(`${nextSelectedState ? "Selected" : "Deselected"} ${changedCount} filtered link(s).`);
  }
}

async function invertFilteredLinkSelection() {
  const filteredLinks = getFilteredLinks(panelState.collectedLinks, panelState.resultsFilterQuery);
  if (filteredLinks.length === 0) {
    setStatus("No links match the current filter.");
    return;
  }

  const filteredIds = new Set(filteredLinks.map((link) => link.id));
  let changedCount = 0;
  const nextLinks = panelState.collectedLinks.map((link) => {
    if (!filteredIds.has(link.id)) {
      return link;
    }

    changedCount += 1;
    return {
      ...link,
      selected: link.selected === false
    };
  });

  setCollectedLinksState(nextLinks);
  const persisted = await persistCollectedLinks();
  if (persisted) {
    setStatus(`Inverted selection for ${changedCount} filtered link(s).`);
  }
}

async function clearCollectedLinks() {
  const removedCount = panelState.collectedLinks.length;
  if (removedCount === 0) {
    setStatus("No collected links to clear.");
    return;
  }

  setCollectedLinksState([]);
  const persisted = await persistCollectedLinks();
  if (persisted) {
    setStatus(`Cleared ${removedCount} collected link(s).`);
  }
}

async function persistCollectedLinks() {
  const snapshot = panelState.collectedLinks.map((link) => ({ ...link }));

  return panelStore.enqueueCollectedLinksPersist(async () => {
    try {
      const response = await setCollectedLinksAction(snapshot);
      if (!response || response.ok !== true) {
        setStatus(messageFromError(response?.error) ?? "Failed to save curated links.");
        return false;
      }

      setCollectedLinksState(response.links);
      return true;
    } catch (error) {
      console.error("[zotero-archivist] Failed to persist curated links.", error);
      setStatus("Failed to save curated links.");
      return false;
    }
  });
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
    integrationModeEl,
    integrationBridgeRowEl,
    integrationBridgeStatusEl,
    integrationConnectorRowEl,
    integrationConnectorStatusEl,
    integrationZoteroRowEl,
    integrationZoteroStatusEl,
    integrationErrorEl
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

function getFilteredLinks(links, filterQuery) {
  return getFilteredLinksView(links, filterQuery);
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
