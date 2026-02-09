import {
  ERROR_CODES,
  MESSAGE_TYPES,
  isHttpUrl,
  toOriginPattern
} from "../shared/protocol.js";

const collectButton = document.getElementById("collect-links-button");
const addRuleButton = document.getElementById("add-rule-button");
const saveRulesButton = document.getElementById("save-rules-button");
const selectorRulesListEl = document.getElementById("selector-rules-list");
const statusEl = document.getElementById("status");
const resultsTitleEl = document.getElementById("results-title");
const resultsListEl = document.getElementById("results-list");
const rulesSummaryEl = document.getElementById("rules-summary");

let selectorRulesDirty = false;
let selectorRuleCounter = 0;

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
  const collectedLinks = Array.isArray(response.collectedLinks) ? response.collectedLinks : [];

  renderSelectorRules(selectorRules);
  renderLinks(collectedLinks);
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

    const links = Array.isArray(response.links) ? response.links : [];
    renderLinks(links);
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

  const topRow = document.createElement("div");
  topRow.className = "rule-top-row";

  const toggleLabel = document.createElement("label");
  toggleLabel.className = "rule-toggle";
  const toggleInput = document.createElement("input");
  toggleInput.className = "rule-enabled-input";
  toggleInput.type = "checkbox";
  toggleInput.checked = rule.enabled !== false;
  toggleLabel.append(toggleInput, document.createTextNode("Enabled"));

  const deleteButton = document.createElement("button");
  deleteButton.className = "rule-delete-button";
  deleteButton.type = "button";
  deleteButton.textContent = "Delete";

  topRow.append(toggleLabel, deleteButton);

  const fields = document.createElement("div");
  fields.className = "rule-fields";
  fields.append(
    createRuleField("Name", "rule-name-input", rule.name ?? "", "Readable label"),
    createRuleField("CSS selector", "rule-selector-input", rule.cssSelector ?? "", "a[href]"),
    createRuleField("URL attribute", "rule-attribute-input", rule.urlAttribute ?? "href", "href"),
    createRuleField("Include pattern", "rule-include-input", rule.includePattern ?? "", "optional"),
    createRuleField("Exclude pattern", "rule-exclude-input", rule.excludePattern ?? "", "optional")
  );

  item.append(topRow, fields);
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

function renderLinks(links) {
  const safeLinks = Array.isArray(links) ? links : [];

  resultsListEl.textContent = "";
  resultsTitleEl.textContent = `Collected Links (${safeLinks.length})`;

  for (const link of safeLinks) {
    const item = document.createElement("li");
    item.className = "result-item";

    const anchor = document.createElement("a");
    anchor.className = "result-link";
    anchor.href = typeof link.url === "string" ? link.url : "#";
    anchor.target = "_blank";
    anchor.rel = "noreferrer noopener";
    anchor.textContent =
      typeof link.title === "string" && link.title.trim().length > 0 ? link.title : anchor.href;

    const meta = document.createElement("div");
    meta.className = "result-meta";
    meta.textContent = anchor.href;

    item.append(anchor, meta);
    resultsListEl.append(item);
  }
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
