import {
  ERROR_CODES,
  MESSAGE_TYPES,
  STORAGE_KEYS,
  isHttpUrl,
  toOriginPattern
} from "../shared/protocol.js";

const collectButton = document.getElementById("collect-links-button");
const addRuleButton = document.getElementById("add-rule-button");
const saveRulesButton = document.getElementById("save-rules-button");
const selectorRulesListEl = document.getElementById("selector-rules-list");
const statusEl = document.getElementById("status");
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
const enableConnectorBridgeInput = document.getElementById("enable-connector-bridge-input");
const integrationModeEl = document.getElementById("integration-mode");
const integrationHealthEl = document.getElementById("integration-health");

let selectorRulesDirty = false;
let selectorRuleCounter = 0;
let collectedLinksState = [];
let queueItemsState = [];
let queueRuntimeState = createDefaultQueueRuntimeState();
let providerSettingsState = createDefaultProviderSettingsState();
let providerDiagnosticsState = createDefaultProviderDiagnosticsState();
let resultsFilterQuery = normalizeFilterQuery(resultsFilterInput.value);
let persistCollectedLinksQueue = Promise.resolve();
let queueAuthoringInProgress = false;
let queueClearingInProgress = false;
let queueLifecycleInProgress = false;
let providerSettingsInProgress = false;

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
  resultsFilterQuery = normalizeFilterQuery(resultsFilterInput.value);
  renderLinks(collectedLinksState);
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

enableConnectorBridgeInput.addEventListener("change", () => {
  void updateProviderSettings();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  handleStorageChange(changes, areaName);
});

renderIntegrationState();
updateQueueActionState();

void loadPanelState();

async function loadPanelState() {
  setStatus("Loading panel state...");

  const response = await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.GET_PANEL_STATE
  });

  if (!response || response.ok !== true) {
    setStatus(messageFromError(response?.error) ?? "Failed to load extension state.");
    return;
  }

  const selectorRules = normalizeSelectorRules(response.selectorRules);
  const collectedLinks = normalizeCollectedLinks(response.collectedLinks);
  const queueItems = normalizeQueueItems(response.queueItems);
  const queueRuntime = normalizeQueueRuntime(response.queueRuntime);
  const providerSettings = normalizeProviderSettings(response.providerSettings);
  const providerDiagnostics = normalizeProviderDiagnostics(response.providerDiagnostics);

  renderSelectorRules(selectorRules);
  setCollectedLinksState(collectedLinks);
  setQueueItemsState(queueItems);
  setQueueRuntimeState(queueRuntime);
  setProviderSettingsState(providerSettings);
  setProviderDiagnosticsState(providerDiagnostics);
  setSelectorRulesDirty(false);
  setStatus("Ready.");
}

async function collectLinks() {
  if (selectorRulesDirty) {
    setStatus("Save selector rules before collecting links.");
    return;
  }

  collectButton.disabled = true;

  try {
    const activeTab = await getActiveTab();
    if (!activeTab || typeof activeTab.url !== "string") {
      setStatus("No active tab found.");
      return;
    }

    if (!isHttpUrl(activeTab.url)) {
      setStatus("Collect Links only works on http(s) pages.");
      return;
    }

    setStatus("Checking host permission...");
    const permissionResult = await ensureHostPermission(activeTab.url);
    if (!permissionResult.granted) {
      setStatus("Permission was not granted for this site.");
      return;
    }

    setStatus("Collecting links...");
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.COLLECT_LINKS
    });

    if (!response || response.ok !== true) {
      const errorCode = response?.error?.code;
      if (errorCode === ERROR_CODES.MISSING_HOST_PERMISSION) {
        setStatus("Host permission is required to collect links.");
      } else {
        setStatus(messageFromError(response?.error) ?? "Collect Links failed.");
      }
      return;
    }

    const links = normalizeCollectedLinks(response.links);
    setCollectedLinksState(links);
    setStatus(`Collected ${links.length} link(s).`);
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
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.SET_SELECTOR_RULES,
      payload: {
        rules: draftRules
      }
    });

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
  if (!Array.isArray(rules)) {
    return [];
  }

  const normalized = [];
  const seenIds = new Set();
  for (const rule of rules) {
    if (!rule || typeof rule !== "object") {
      continue;
    }

    const id = typeof rule.id === "string" && rule.id.trim().length > 0 ? rule.id.trim() : nextRuleId();
    if (seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);

    const cssSelector =
      typeof rule.cssSelector === "string" && rule.cssSelector.trim().length > 0
        ? rule.cssSelector.trim()
        : "a[href]";

    const normalizedRule = {
      id,
      name: typeof rule.name === "string" && rule.name.trim().length > 0 ? rule.name.trim() : id,
      cssSelector,
      urlAttribute:
        typeof rule.urlAttribute === "string" && rule.urlAttribute.trim().length > 0
          ? rule.urlAttribute.trim()
          : "href",
      enabled: rule.enabled !== false
    };

    if (typeof rule.includePattern === "string" && rule.includePattern.trim().length > 0) {
      normalizedRule.includePattern = rule.includePattern.trim();
    }

    if (typeof rule.excludePattern === "string" && rule.excludePattern.trim().length > 0) {
      normalizedRule.excludePattern = rule.excludePattern.trim();
    }

    normalized.push(normalizedRule);
  }

  return normalized;
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
  if (!selectorRulesDirty) {
    selectorRulesDirty = true;
  }
  updateRulesSummary(getDraftSelectorRuleCount());
}

function setSelectorRulesDirty(isDirty) {
  selectorRulesDirty = Boolean(isDirty);
  updateRulesSummary(getDraftSelectorRuleCount());
}

function updateRulesSummary(ruleCount) {
  const dirtySuffix = selectorRulesDirty ? " (unsaved changes)" : "";
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
  selectorRuleCounter += 1;
  return `rule-${Date.now()}-${selectorRuleCounter}`;
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

async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });
  return tabs[0] ?? null;
}

async function ensureHostPermission(tabUrl) {
  const originPattern = toOriginPattern(tabUrl);
  if (!originPattern) {
    return { granted: false };
  }

  const hasPermission = await chrome.permissions.contains({
    origins: [originPattern]
  });
  if (hasPermission) {
    return { granted: true, alreadyGranted: true, originPattern };
  }

  const granted = await chrome.permissions.request({
    origins: [originPattern]
  });
  return { granted, alreadyGranted: false, originPattern };
}

function setCollectedLinksState(links) {
  collectedLinksState = normalizeCollectedLinks(links);
  renderLinks(collectedLinksState);
}

function setQueueItemsState(queueItems) {
  queueItemsState = normalizeQueueItems(queueItems);
  renderQueue(queueItemsState);
  renderQueueRuntimeStatus(queueRuntimeState);
}

function setQueueRuntimeState(queueRuntime) {
  queueRuntimeState = normalizeQueueRuntime(queueRuntime);
  renderQueueRuntimeStatus(queueRuntimeState);
  updateQueueActionState();
}

function setProviderSettingsState(providerSettings) {
  providerSettingsState = normalizeProviderSettings(providerSettings);
  renderIntegrationState();
}

function setProviderDiagnosticsState(providerDiagnostics) {
  providerDiagnosticsState = normalizeProviderDiagnostics(providerDiagnostics);
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

  const providerSettingsChange = changes[STORAGE_KEYS.PROVIDER_SETTINGS];
  if (providerSettingsChange) {
    setProviderSettingsState(providerSettingsChange.newValue);
  }

  const providerDiagnosticsChange = changes[STORAGE_KEYS.PROVIDER_DIAGNOSTICS];
  if (providerDiagnosticsChange) {
    setProviderDiagnosticsState(providerDiagnosticsChange.newValue);
  }
}

async function updateProviderSettings() {
  const requestedConnectorBridgeEnabled = enableConnectorBridgeInput.checked;
  providerSettingsInProgress = true;
  updateQueueActionState();
  renderIntegrationState();

  try {
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.SET_PROVIDER_SETTINGS,
      payload: {
        settings: {
          connectorBridgeEnabled: requestedConnectorBridgeEnabled
        }
      }
    });

    if (!response || response.ok !== true) {
      setStatus(messageFromError(response?.error) ?? "Failed to update provider settings.");
      renderIntegrationState();
      return;
    }

    if (response.providerSettings) {
      setProviderSettingsState(response.providerSettings);
    }
    if (response.providerDiagnostics) {
      setProviderDiagnosticsState(response.providerDiagnostics);
    }

    if (providerSettingsState.connectorBridgeEnabled) {
      setStatus("Connector bridge setting enabled.");
    } else {
      setStatus("Connector bridge setting disabled.");
    }
  } catch (error) {
    console.error("[zotero-archivist] Failed to update provider settings.", error);
    setStatus("Failed to update provider settings.");
  } finally {
    providerSettingsInProgress = false;
    updateQueueActionState();
    renderIntegrationState();
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
  queueLifecycleInProgress = true;
  updateQueueActionState();

  try {
    const response = await chrome.runtime.sendMessage({
      type: messageType
    });

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
    queueLifecycleInProgress = false;
    updateQueueActionState();
  }
}

async function addSelectedLinksToQueue() {
  const selectedLinks = collectedLinksState.filter((link) => link.selected !== false);
  if (selectedLinks.length === 0) {
    setStatus("Select at least one link to add to queue.");
    return;
  }

  queueAuthoringInProgress = true;
  updateQueueActionState();

  try {
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.AUTHOR_QUEUE_FROM_SELECTION,
      payload: {
        links: selectedLinks
      }
    });

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
    queueAuthoringInProgress = false;
    updateQueueActionState();
  }
}

async function clearQueueItems() {
  if (queueItemsState.length === 0) {
    setStatus("Queue is already empty.");
    return;
  }

  queueClearingInProgress = true;
  updateQueueActionState();

  try {
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.CLEAR_QUEUE
    });

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
    queueClearingInProgress = false;
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
  const nextLinks = collectedLinksState.map((link) => {
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
  const filteredLinks = getFilteredLinks(collectedLinksState, resultsFilterQuery);
  if (filteredLinks.length === 0) {
    setStatus("No links match the current filter.");
    return;
  }

  const filteredIds = new Set(filteredLinks.map((link) => link.id));
  let changedCount = 0;
  const nextLinks = collectedLinksState.map((link) => {
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
  const filteredLinks = getFilteredLinks(collectedLinksState, resultsFilterQuery);
  if (filteredLinks.length === 0) {
    setStatus("No links match the current filter.");
    return;
  }

  const filteredIds = new Set(filteredLinks.map((link) => link.id));
  let changedCount = 0;
  const nextLinks = collectedLinksState.map((link) => {
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
  const removedCount = collectedLinksState.length;
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
  const snapshot = collectedLinksState.map((link) => ({ ...link }));

  persistCollectedLinksQueue = persistCollectedLinksQueue
    .catch(() => false)
    .then(async () => {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.SET_COLLECTED_LINKS,
        payload: {
          links: snapshot
        }
      });

      if (!response || response.ok !== true) {
        setStatus(messageFromError(response?.error) ?? "Failed to save curated links.");
        return false;
      }

      collectedLinksState = normalizeCollectedLinks(response.links);
      renderLinks(collectedLinksState);
      return true;
    })
    .catch((error) => {
      console.error("[zotero-archivist] Failed to persist curated links.", error);
      setStatus("Failed to save curated links.");
      return false;
    });

  return persistCollectedLinksQueue;
}

function renderLinks(links) {
  const safeLinks = Array.isArray(links) ? links : [];
  const filteredLinks = getFilteredLinks(safeLinks, resultsFilterQuery);
  const selectedCount = safeLinks.filter((link) => link.selected !== false).length;

  resultsTitleEl.textContent = `Collected Links (${safeLinks.length})`;
  updateResultsSummary({
    selectedCount,
    totalCount: safeLinks.length,
    filteredCount: filteredLinks.length
  });
  updateResultsControlState({
    totalCount: safeLinks.length,
    filteredCount: filteredLinks.length
  });

  resultsListEl.textContent = "";
  if (safeLinks.length === 0) {
    resultsListEl.append(createResultMessageItem("No links collected yet."));
    return;
  }

  if (filteredLinks.length === 0) {
    resultsListEl.append(createResultMessageItem("No links match the current filter."));
    return;
  }

  for (const link of filteredLinks) {
    const item = document.createElement("li");
    item.className = "result-item";

    const row = document.createElement("div");
    row.className = "result-row";

    const selectLabel = document.createElement("label");
    selectLabel.className = "result-select";
    const selectInput = document.createElement("input");
    selectInput.className = "result-selected-input";
    selectInput.type = "checkbox";
    selectInput.checked = link.selected !== false;
    selectInput.dataset.linkId = link.id;
    selectInput.setAttribute("aria-label", `Select link ${link.title}`);
    selectLabel.append(selectInput);

    const anchor = document.createElement("a");
    anchor.className = "result-link";
    anchor.href = link.url;
    anchor.target = "_blank";
    anchor.rel = "noreferrer noopener";
    anchor.textContent = link.title;

    const meta = document.createElement("div");
    meta.className = "result-meta";
    meta.textContent = link.url;

    row.append(selectLabel, anchor);
    item.append(row, meta);
    resultsListEl.append(item);
  }
}

function renderQueue(queueItems) {
  const safeQueueItems = Array.isArray(queueItems) ? queueItems : [];

  queueTitleEl.textContent = `Queue (${safeQueueItems.length})`;
  queueSummaryEl.textContent = summarizeQueueCounts(safeQueueItems);
  updateQueueActionState();

  queueListEl.textContent = "";
  if (safeQueueItems.length === 0) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "queue-empty";
    emptyItem.textContent = "Queue is empty.";
    queueListEl.append(emptyItem);
    return;
  }

  for (const queueItem of safeQueueItems) {
    const item = document.createElement("li");
    item.className = "queue-item";

    const row = document.createElement("div");
    row.className = "queue-item-row";

    const link = document.createElement("a");
    link.className = "queue-link";
    link.href = queueItem.url;
    link.target = "_blank";
    link.rel = "noreferrer noopener";
    link.textContent = queueItem.title;

    const statusBadge = document.createElement("span");
    statusBadge.className = `queue-status queue-status-${queueItem.status}`;
    statusBadge.textContent = formatQueueStatusLabel(queueItem.status);

    const meta = document.createElement("div");
    meta.className = "queue-item-meta";
    const attemptsEl = document.createElement("div");
    attemptsEl.textContent = `Attempts: ${queueItem.attempts}`;
    meta.append(attemptsEl);

    if (typeof queueItem.lastError === "string" && queueItem.lastError.length > 0) {
      const errorEl = document.createElement("div");
      errorEl.className = "queue-item-error";
      errorEl.textContent = queueItem.lastError;
      meta.append(errorEl);
    }

    row.append(link, statusBadge);
    item.append(row, meta);
    queueListEl.append(item);
  }
}

function renderIntegrationState() {
  enableConnectorBridgeInput.checked = providerSettingsState.connectorBridgeEnabled === true;
  enableConnectorBridgeInput.disabled = providerSettingsInProgress;

  integrationModeEl.textContent = `Mode: ${formatProviderModeLabel(providerDiagnosticsState.activeMode)}`;

  const connectorStatus = providerDiagnosticsState.connectorBridge;
  const connectorHealthLabel =
    connectorStatus.healthy === true ? "healthy" : connectorStatus.enabled ? "degraded" : "disabled";

  const summaryParts = [
    `Connector bridge: ${connectorHealthLabel}`,
    connectorStatus.details
  ];
  if (typeof providerDiagnosticsState.lastError === "string" && providerDiagnosticsState.lastError.length > 0) {
    summaryParts.push(providerDiagnosticsState.lastError);
  }

  integrationHealthEl.textContent = summaryParts.join(" • ");
}

function renderQueueRuntimeStatus(queueRuntime) {
  if (!queueRuntime || typeof queueRuntime !== "object") {
    queueRuntimeStatusEl.textContent = "Queue runtime: idle.";
    return;
  }

  if (queueRuntime.status === "running") {
    if (typeof queueRuntime.activeQueueItemId === "string") {
      queueRuntimeStatusEl.textContent = "Queue runtime: running (processing active item).";
      return;
    }
    queueRuntimeStatusEl.textContent = "Queue runtime: running.";
    return;
  }

  if (queueRuntime.status === "paused") {
    queueRuntimeStatusEl.textContent = "Queue runtime: paused.";
    return;
  }

  queueRuntimeStatusEl.textContent = "Queue runtime: idle.";
}

function updateResultsSummary({ selectedCount, totalCount, filteredCount }) {
  const summaryParts = [`${selectedCount} selected`];
  if (resultsFilterQuery.length > 0) {
    summaryParts.push(`showing ${filteredCount} of ${totalCount}`);
  }
  resultsSummaryEl.textContent = summaryParts.join(" • ");
}

function updateResultsControlState({ totalCount, filteredCount }) {
  const hasFilteredLinks = filteredCount > 0;
  const hasCollectedLinks = totalCount > 0;

  resultsFilterInput.disabled = false;
  selectAllLinksButton.disabled = !hasFilteredLinks;
  deselectAllLinksButton.disabled = !hasFilteredLinks;
  invertLinksButton.disabled = !hasFilteredLinks;
  clearAllLinksButton.disabled = !hasCollectedLinks;
  updateQueueActionState();
}

function updateQueueActionState() {
  const selectedCount = collectedLinksState.filter((link) => link.selected !== false).length;
  const queueBusy = isQueueBusy();
  const queueCounts = getQueueItemCounts(queueItemsState);
  const hasActiveQueueItem = typeof queueRuntimeState.activeQueueItemId === "string";

  addSelectedToQueueButton.disabled = queueBusy || selectedCount === 0;
  clearQueueButton.disabled =
    queueBusy || queueItemsState.length === 0 || queueRuntimeState.status === "running";
  startQueueButton.disabled =
    queueBusy || queueRuntimeState.status !== "idle" || queueCounts.pendingCount === 0;
  pauseQueueButton.disabled = queueBusy || queueRuntimeState.status !== "running";
  resumeQueueButton.disabled =
    queueBusy ||
    queueRuntimeState.status !== "paused" ||
    (queueCounts.pendingCount === 0 && !hasActiveQueueItem);
  stopQueueButton.disabled = queueBusy || queueRuntimeState.status === "idle";
  retryFailedQueueButton.disabled =
    queueBusy ||
    queueRuntimeState.status === "running" ||
    queueCounts.retriableCount === 0;
  enableConnectorBridgeInput.disabled = providerSettingsInProgress;
}

function isQueueBusy() {
  return (
    queueAuthoringInProgress ||
    queueClearingInProgress ||
    queueLifecycleInProgress ||
    providerSettingsInProgress
  );
}

function createResultMessageItem(message) {
  const item = document.createElement("li");
  item.className = "result-item result-empty";
  item.textContent = message;
  return item;
}

function getFilteredLinks(links, filterQuery) {
  if (!Array.isArray(links) || links.length === 0) {
    return [];
  }

  if (filterQuery.length === 0) {
    return links;
  }

  return links.filter((link) => {
    const normalizedTitle = typeof link.title === "string" ? link.title.toLowerCase() : "";
    const normalizedUrl = typeof link.url === "string" ? link.url.toLowerCase() : "";
    return normalizedTitle.includes(filterQuery) || normalizedUrl.includes(filterQuery);
  });
}

function normalizeFilterQuery(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().toLowerCase();
}

function normalizeCollectedLinks(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  const normalized = [];
  const seenIds = new Set();
  for (const candidate of input) {
    if (!candidate || typeof candidate !== "object" || typeof candidate.url !== "string") {
      continue;
    }

    if (!isHttpUrl(candidate.url)) {
      continue;
    }

    const normalizedUrl = new URL(candidate.url).toString();
    const fallbackId = `link-${normalized.length + 1}`;
    const candidateId = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const id = candidateId.length > 0 ? candidateId : fallbackId;
    if (seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);

    normalized.push({
      id,
      url: normalizedUrl,
      title:
        typeof candidate.title === "string" && candidate.title.trim().length > 0
          ? candidate.title.trim()
          : normalizedUrl,
      sourceSelectorId:
        typeof candidate.sourceSelectorId === "string" && candidate.sourceSelectorId.length > 0
          ? candidate.sourceSelectorId
          : "unknown",
      selected: candidate.selected !== false,
      dedupeKey:
        typeof candidate.dedupeKey === "string" && candidate.dedupeKey.length > 0
          ? candidate.dedupeKey
          : normalizedUrl.toLowerCase()
    });
  }

  return normalized;
}

function normalizeQueueItems(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  const normalized = [];
  const seenUrls = new Set();
  for (const candidate of input) {
    if (!candidate || typeof candidate !== "object" || typeof candidate.url !== "string") {
      continue;
    }

    if (!isHttpUrl(candidate.url)) {
      continue;
    }

    const url = new URL(candidate.url).toString();
    const dedupeKey = url.toLowerCase();
    if (seenUrls.has(dedupeKey)) {
      continue;
    }
    seenUrls.add(dedupeKey);

    const status = normalizeQueueStatus(candidate.status);
    const queueItem = {
      id:
        typeof candidate.id === "string" && candidate.id.trim().length > 0
          ? candidate.id.trim()
          : `queue-${normalized.length + 1}`,
      url,
      title:
        typeof candidate.title === "string" && candidate.title.trim().length > 0
          ? candidate.title.trim()
          : url,
      status,
      attempts:
        Number.isFinite(candidate.attempts) && candidate.attempts >= 0
          ? Math.trunc(candidate.attempts)
          : 0,
      createdAt:
        Number.isFinite(candidate.createdAt) && candidate.createdAt > 0
          ? Math.trunc(candidate.createdAt)
          : Date.now(),
      updatedAt:
        Number.isFinite(candidate.updatedAt) && candidate.updatedAt > 0
          ? Math.trunc(candidate.updatedAt)
          : Date.now()
    };

    if (typeof candidate.lastError === "string" && candidate.lastError.trim().length > 0) {
      queueItem.lastError = candidate.lastError.trim();
    }

    normalized.push(queueItem);
  }

  return normalized;
}

function normalizeQueueStatus(status) {
  switch (status) {
    case "pending":
    case "opening_tab":
    case "saving_snapshot":
    case "archived":
    case "failed":
    case "cancelled":
      return status;
    default:
      return "pending";
  }
}

function normalizeQueueRuntime(input) {
  if (!input || typeof input !== "object") {
    return createDefaultQueueRuntimeState();
  }

  const status =
    typeof input.status === "string" &&
    (input.status === "idle" || input.status === "running" || input.status === "paused")
      ? input.status
      : "idle";

  const activeQueueItemId =
    typeof input.activeQueueItemId === "string" && input.activeQueueItemId.length > 0
      ? input.activeQueueItemId
      : null;

  const activeTabId = Number.isInteger(input.activeTabId) ? input.activeTabId : null;

  const updatedAt =
    Number.isFinite(input.updatedAt) && input.updatedAt > 0 ? Math.trunc(input.updatedAt) : Date.now();

  if (status === "idle") {
    return {
      status,
      activeQueueItemId: null,
      activeTabId: null,
      updatedAt
    };
  }

  if (activeQueueItemId === null || activeTabId === null) {
    return {
      status,
      activeQueueItemId: null,
      activeTabId: null,
      updatedAt
    };
  }

  return {
    status,
    activeQueueItemId,
    activeTabId,
    updatedAt
  };
}

function normalizeProviderSettings(input) {
  if (!input || typeof input !== "object") {
    return createDefaultProviderSettingsState();
  }

  return {
    connectorBridgeEnabled:
      typeof input.connectorBridgeEnabled === "boolean"
        ? input.connectorBridgeEnabled
        : createDefaultProviderSettingsState().connectorBridgeEnabled
  };
}

function createDefaultProviderSettingsState() {
  return {
    connectorBridgeEnabled: true
  };
}

function normalizeProviderDiagnostics(input) {
  if (!input || typeof input !== "object") {
    return createDefaultProviderDiagnosticsState();
  }

  const connectorBridgeInput =
    input.connectorBridge && typeof input.connectorBridge === "object" ? input.connectorBridge : {};
  const defaultConnectorBridgeEnabled = createDefaultProviderSettingsState().connectorBridgeEnabled;
  const connectorBridgeEnabled =
    typeof connectorBridgeInput.enabled === "boolean"
      ? connectorBridgeInput.enabled
      : defaultConnectorBridgeEnabled;
  const activeMode =
    typeof input.activeMode === "string" && input.activeMode.length > 0
      ? input.activeMode
      : "connector_bridge";

  return {
    activeMode,
    connectorBridge: {
      enabled: connectorBridgeEnabled,
      healthy: connectorBridgeInput.healthy === true,
      details:
        typeof connectorBridgeInput.details === "string" && connectorBridgeInput.details.trim().length > 0
          ? connectorBridgeInput.details.trim()
          : connectorBridgeEnabled
            ? "Connector bridge status unknown."
            : "Connector bridge is disabled."
    },
    lastError:
      typeof input.lastError === "string" && input.lastError.trim().length > 0
        ? input.lastError.trim()
        : null,
    updatedAt:
      Number.isFinite(input.updatedAt) && input.updatedAt > 0 ? Math.trunc(input.updatedAt) : Date.now()
  };
}

function createDefaultProviderDiagnosticsState() {
  return {
    activeMode: "connector_bridge",
    connectorBridge: {
      enabled: true,
      healthy: false,
      details: "Connector bridge status unknown."
    },
    lastError: null,
    updatedAt: Date.now()
  };
}

function createDefaultQueueRuntimeState() {
  return {
    status: "idle",
    activeQueueItemId: null,
    activeTabId: null,
    updatedAt: Date.now()
  };
}

function getQueueItemCounts(queueItems) {
  const safeQueueItems = Array.isArray(queueItems) ? queueItems : [];
  const pendingCount = safeQueueItems.filter((item) => item.status === "pending").length;
  const archivedCount = safeQueueItems.filter((item) => item.status === "archived").length;
  const failedCount = safeQueueItems.filter((item) => item.status === "failed").length;
  const cancelledCount = safeQueueItems.filter((item) => item.status === "cancelled").length;
  const retriableCount = failedCount + cancelledCount;

  return {
    pendingCount,
    archivedCount,
    failedCount,
    cancelledCount,
    retriableCount
  };
}

function summarizeQueueCounts(queueItems) {
  if (!Array.isArray(queueItems) || queueItems.length === 0) {
    return "0 pending";
  }

  const counts = getQueueItemCounts(queueItems);

  const summaryParts = [`${counts.pendingCount} pending`];
  if (counts.archivedCount > 0) {
    summaryParts.push(`${counts.archivedCount} archived`);
  }
  if (counts.failedCount > 0) {
    summaryParts.push(`${counts.failedCount} failed`);
  }

  return summaryParts.join(" • ");
}

function formatQueueStatusLabel(status) {
  return status.replaceAll("_", " ");
}

function formatProviderModeLabel(mode) {
  if (mode === "connector_bridge") {
    return "connector bridge";
  }
  if (mode === "local_api") {
    return "local api";
  }
  return "connector bridge";
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
