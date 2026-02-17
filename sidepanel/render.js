import { getQueueItemCounts, isQueueItemActiveStatus } from "../shared/state.js";

export function initializeSectionToggle(toggleButton, sectionBody) {
  if (!(toggleButton instanceof HTMLButtonElement) || !(sectionBody instanceof HTMLElement)) {
    return;
  }

  const currentlyExpanded = toggleButton.getAttribute("aria-expanded") === "true";
  sectionBody.hidden = !currentlyExpanded;

  toggleButton.addEventListener("click", () => {
    const nextExpanded = toggleButton.getAttribute("aria-expanded") !== "true";
    toggleButton.setAttribute("aria-expanded", nextExpanded ? "true" : "false");
    sectionBody.hidden = !nextExpanded;
  });
}

export function renderLinks({
  links,
  resultsFilterQuery,
  resultsTitleEl,
  resultsSummaryEl,
  resultsListEl,
  resultsFilterInput,
  selectAllLinksButton,
  deselectAllLinksButton,
  invertLinksButton,
  clearAllLinksButton,
  updateQueueActionState
}) {
  const safeLinks = Array.isArray(links) ? links : [];
  const filteredLinks = getFilteredLinks(safeLinks, resultsFilterQuery);
  const selectedCount = safeLinks.filter((link) => link.selected !== false).length;

  resultsTitleEl.textContent = `Collected Links (${safeLinks.length})`;
  updateResultsSummary({
    selectedCount,
    totalCount: safeLinks.length,
    filteredCount: filteredLinks.length,
    resultsFilterQuery,
    resultsSummaryEl
  });
  updateResultsControlState({
    totalCount: safeLinks.length,
    filteredCount: filteredLinks.length,
    resultsFilterInput,
    selectAllLinksButton,
    deselectAllLinksButton,
    invertLinksButton,
    clearAllLinksButton,
    updateQueueActionState
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

export function renderQueue({ queueItems, queueTitleEl, queueSummaryEl, queueListEl, updateQueueActionState }) {
  const safeQueueItems = Array.isArray(queueItems) ? queueItems : [];

  queueTitleEl.textContent = `Queue (${safeQueueItems.length})`;
  queueSummaryEl.textContent = summarizeQueueCounts(safeQueueItems);

  queueListEl.textContent = "";
  if (safeQueueItems.length === 0) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "queue-empty";
    emptyItem.textContent = "Queue is empty.";
    queueListEl.append(emptyItem);
    updateQueueActionState();
    return;
  }

  let activeQueueItemEl = null;
  for (const queueItem of safeQueueItems) {
    const isActiveQueueItem = isQueueItemActiveStatus(queueItem.status);
    const item = document.createElement("li");
    item.className = isActiveQueueItem ? "queue-item queue-item-active" : "queue-item";
    if (isActiveQueueItem && activeQueueItemEl === null) {
      activeQueueItemEl = item;
    }

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

    const removeButton = document.createElement("button");
    removeButton.className = "queue-item-remove-button";
    removeButton.type = "button";
    removeButton.dataset.queueItemId = queueItem.id;
    removeButton.textContent = "Remove";
    removeButton.setAttribute("aria-label", `Remove ${queueItem.title} from queue`);

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

    row.append(link, removeButton, statusBadge);
    item.append(row, meta);
    queueListEl.append(item);
  }

  scrollQueueListToActiveItem(queueListEl, activeQueueItemEl);
  updateQueueActionState();
}

export function renderIntegrationState({
  providerDiagnosticsState,
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
  integrationBusy = false
}) {
  integrationModeEl.textContent = `Mode: ${formatProviderModeLabel(providerDiagnosticsState.activeMode)}`;
  if (integrationUpdatedAtEl instanceof HTMLElement) {
    integrationUpdatedAtEl.textContent = formatIntegrationUpdatedAt(providerDiagnosticsState.updatedAt);
  }

  if (refreshDiagnosticsButton instanceof HTMLButtonElement) {
    refreshDiagnosticsButton.disabled = integrationBusy;
  }

  const connectorStatus = providerDiagnosticsState.connectorBridge;
  const bridgeState = resolveBridgeDisplayState(connectorStatus);
  const connectorState = resolveConnectorDisplayState(connectorStatus);
  const zoteroState = resolveZoteroDisplayState(connectorStatus);

  setIntegrationStatusRow(integrationBridgeRowEl, integrationBridgeStatusEl, bridgeState);
  setIntegrationStatusRow(integrationConnectorRowEl, integrationConnectorStatusEl, connectorState);
  setIntegrationStatusRow(integrationZoteroRowEl, integrationZoteroStatusEl, zoteroState);

  if (typeof providerDiagnosticsState.lastError === "string" && providerDiagnosticsState.lastError.length > 0) {
    integrationErrorEl.hidden = false;
    integrationErrorEl.textContent = providerDiagnosticsState.lastError;
  } else {
    integrationErrorEl.hidden = true;
    integrationErrorEl.textContent = "";
  }
}

export function renderQueueRuntimeStatus({ queueRuntime, queueRuntimeStatusEl }) {
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

export function getFilteredLinks(links, filterQuery) {
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

export function normalizeFilterQuery(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().toLowerCase();
}

function updateResultsSummary({
  selectedCount,
  totalCount,
  filteredCount,
  resultsFilterQuery,
  resultsSummaryEl
}) {
  const summaryParts = [`${selectedCount} selected`];
  if (resultsFilterQuery.length > 0) {
    summaryParts.push(`showing ${filteredCount} of ${totalCount}`);
  }
  resultsSummaryEl.textContent = summaryParts.join(" • ");
}

function updateResultsControlState({
  totalCount,
  filteredCount,
  resultsFilterInput,
  selectAllLinksButton,
  deselectAllLinksButton,
  invertLinksButton,
  clearAllLinksButton,
  updateQueueActionState
}) {
  const hasFilteredLinks = filteredCount > 0;
  const hasCollectedLinks = totalCount > 0;

  resultsFilterInput.disabled = false;
  selectAllLinksButton.disabled = !hasFilteredLinks;
  deselectAllLinksButton.disabled = !hasFilteredLinks;
  invertLinksButton.disabled = !hasFilteredLinks;
  clearAllLinksButton.disabled = !hasCollectedLinks;
  updateQueueActionState();
}

function createResultMessageItem(message) {
  const item = document.createElement("li");
  item.className = "result-item result-empty";
  item.textContent = message;
  return item;
}

function scrollQueueListToActiveItem(queueListEl, activeQueueItemEl) {
  if (
    !(queueListEl instanceof HTMLElement) ||
    !(activeQueueItemEl instanceof HTMLElement) ||
    typeof activeQueueItemEl.scrollIntoView !== "function"
  ) {
    return;
  }

  activeQueueItemEl.scrollIntoView({
    block: "nearest",
    inline: "nearest"
  });
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
  return "connector bridge";
}

function resolveBridgeDisplayState(connectorStatus) {
  if (!connectorStatus || connectorStatus.enabled !== true) {
    return {
      state: "disabled",
      label: "disabled"
    };
  }

  if (connectorStatus.bridgeReady === true) {
    return {
      state: "healthy",
      label: "ready"
    };
  }

  return {
    state: "unhealthy",
    label: "not ready"
  };
}

function resolveConnectorDisplayState(connectorStatus) {
  if (!connectorStatus || connectorStatus.enabled !== true) {
    return {
      state: "disabled",
      label: "disabled"
    };
  }

  if (connectorStatus.connectorAvailable === true) {
    return {
      state: "healthy",
      label: "installed"
    };
  }

  return {
    state: "unhealthy",
    label: "not installed"
  };
}

function resolveZoteroDisplayState(connectorStatus) {
  if (!connectorStatus || connectorStatus.enabled !== true) {
    return {
      state: "disabled",
      label: "disabled"
    };
  }

  if (connectorStatus.zoteroOnline === true) {
    return {
      state: "healthy",
      label: "online"
    };
  }

  if (connectorStatus.zoteroOnline === false) {
    return {
      state: "unhealthy",
      label: "offline"
    };
  }

  return {
    state: "unknown",
    label: "unknown"
  };
}

function setIntegrationStatusRow(rowEl, valueEl, rowState) {
  if (!(rowEl instanceof HTMLElement) || !(valueEl instanceof HTMLElement)) {
    return;
  }

  const normalizedState =
    rowState?.state === "healthy" ||
    rowState?.state === "unhealthy" ||
    rowState?.state === "unknown" ||
    rowState?.state === "disabled"
      ? rowState.state
      : "unknown";

  rowEl.dataset.state = normalizedState;
  valueEl.textContent =
    typeof rowState?.label === "string" && rowState.label.length > 0 ? rowState.label : "unknown";
}

function formatIntegrationUpdatedAt(updatedAt) {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
    return "Last diagnostics check: unknown.";
  }

  try {
    const timestamp = new Date(Math.trunc(updatedAt));
    if (Number.isNaN(timestamp.getTime())) {
      return "Last diagnostics check: unknown.";
    }
    return `Last diagnostics check: ${timestamp.toLocaleString()}.`;
  } catch (_error) {
    return "Last diagnostics check: unknown.";
  }
}
