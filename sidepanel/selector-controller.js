import { sanitizeSelectorRules } from "../shared/protocol.js";

export function createSelectorController({
  panelStore,
  selectorRulesListEl,
  rulesSummaryEl,
  saveRulesButton,
  setSelectorRulesActionImpl,
  setStatus,
  messageFromError,
  logger = console
}) {
  const panelState = panelStore.state;

  function addSelectorRule() {
    const draftRules = readSelectorRulesFromForm(selectorRulesListEl, () => panelStore.nextRuleId());
    draftRules.push(createNewSelectorRule(() => panelStore.nextRuleId()));
    renderSelectorRules(selectorRulesListEl, draftRules);
    setSelectorRulesDirty(true);
    setStatus("Added selector rule. Save rules to apply it.");
  }

  async function saveSelectorRules() {
    const draftRules = readSelectorRulesFromForm(selectorRulesListEl, () => panelStore.nextRuleId());
    const validationError = validateSelectorRules(draftRules);
    if (validationError) {
      setStatus(validationError);
      return;
    }

    saveRulesButton.disabled = true;
    try {
      const response = await setSelectorRulesActionImpl(draftRules);

      if (!response || response.ok !== true) {
        setStatus(messageFromError(response?.error) ?? "Failed to save selector rules.");
        return;
      }

      const persistedRules = normalizeSelectorRules(response.selectorRules);
      renderSelectorRules(selectorRulesListEl, persistedRules);
      setSelectorRulesDirty(false);
      setStatus(`Saved ${persistedRules.length} selector rule(s).`);
    } catch (error) {
      logger.error("[zotero-archivist] Failed to save selector rules.", error);
      setStatus("Failed to save selector rules.");
    } finally {
      saveRulesButton.disabled = false;
    }
  }

  function handleSelectorRuleListClick(event) {
    const target = event?.target;
    if (!target || typeof target.closest !== "function") {
      return;
    }

    const deleteButton = target.closest(".rule-delete-button");
    if (!deleteButton) {
      return;
    }

    const currentItems = selectorRulesListEl.querySelectorAll(".selector-rule-item");
    if (currentItems.length <= 1) {
      setStatus("At least one selector rule is required.");
      return;
    }

    const item = deleteButton.closest(".selector-rule-item");
    if (!item || typeof item.remove !== "function") {
      return;
    }

    item.remove();
    setSelectorRulesDirty(true);
    setStatus("Removed selector rule. Save rules to apply changes.");
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

  return {
    addSelectorRule,
    saveSelectorRules,
    handleSelectorRuleListClick,
    markSelectorRulesDirty,
    setSelectorRulesDirty,
    renderSelectorRules: (rules) => renderSelectorRules(selectorRulesListEl, rules),
    normalizeSelectorRules
  };
}

export function normalizeSelectorRules(rules) {
  return sanitizeSelectorRules(rules);
}

export function validateSelectorRules(rules) {
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

export function createNewSelectorRule(nextRuleId) {
  return {
    id: nextRuleId(),
    name: "Custom rule",
    cssSelector: "a[href]",
    urlAttribute: "href",
    enabled: true
  };
}

export function formatRuleHeading(name, fallbackId) {
  if (typeof name === "string" && name.trim().length > 0) {
    return name.trim();
  }

  if (typeof fallbackId === "string" && fallbackId.trim().length > 0) {
    return fallbackId.trim();
  }

  return "Unnamed rule";
}

function renderSelectorRules(selectorRulesListEl, rules) {
  selectorRulesListEl.textContent = "";

  for (const rule of rules) {
    selectorRulesListEl.append(createSelectorRuleItem(rule));
  }
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
  headingButton.setAttribute("aria-expanded", "false");
  headingButton.setAttribute("title", "Show or hide rule details");

  const headingTitle = document.createElement("span");
  headingTitle.className = "rule-heading-title";
  headingTitle.textContent = formatRuleHeading(rule.name ?? "", rule.id);

  const headingHint = document.createElement("span");
  headingHint.className = "rule-heading-hint";
  headingHint.textContent = "Show details";
  headingButton.append(headingTitle, headingHint);

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
      headingTitle.textContent = formatRuleHeading(nameInput.value, rule.id);
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
    headingHint.textContent = nextExpanded ? "Hide details" : "Show details";
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

function readSelectorRulesFromForm(selectorRulesListEl, nextRuleId) {
  const items = selectorRulesListEl.querySelectorAll(".selector-rule-item");
  const rules = [];

  for (const item of items) {
    const ruleId = readRuleId(item, nextRuleId);
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

function readRuleId(item, nextRuleId) {
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
