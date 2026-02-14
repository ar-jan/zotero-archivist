import {
  DEFAULT_SELECTOR_RULES,
  STORAGE_KEYS,
  sanitizeSelectorRules
} from "../shared/protocol.js";
import {
  normalizeCollectedLinks,
  normalizeQueueItems,
  normalizeQueueRuntime
} from "../shared/state.js";
import { normalizeProviderDiagnostics } from "../zotero/provider-interface.js";

export async function getCollectedLinks() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.COLLECTED_LINKS);
  const collectedLinks = normalizeCollectedLinks(stored[STORAGE_KEYS.COLLECTED_LINKS]);
  if (!Array.isArray(stored[STORAGE_KEYS.COLLECTED_LINKS])) {
    await saveCollectedLinks(collectedLinks);
  }
  return collectedLinks;
}

export async function saveCollectedLinks(links) {
  const normalized = normalizeCollectedLinks(links);
  await chrome.storage.local.set({
    [STORAGE_KEYS.COLLECTED_LINKS]: normalized
  });
  return normalized;
}

export async function getSelectorRules() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.SELECTOR_RULES);
  const rawRules = stored[STORAGE_KEYS.SELECTOR_RULES];
  const sanitizedRules = sanitizeSelectorRules(rawRules);
  const defaults = DEFAULT_SELECTOR_RULES.map((rule) => ({ ...rule }));

  if (sanitizedRules.length === 0) {
    await chrome.storage.local.set({ [STORAGE_KEYS.SELECTOR_RULES]: defaults });
    return defaults;
  }

  if (isLegacyAnchorOnlyDefault(sanitizedRules)) {
    await chrome.storage.local.set({ [STORAGE_KEYS.SELECTOR_RULES]: defaults });
    return defaults;
  }

  const needsWriteBack =
    !Array.isArray(rawRules) || JSON.stringify(rawRules) !== JSON.stringify(sanitizedRules);

  if (needsWriteBack) {
    await chrome.storage.local.set({ [STORAGE_KEYS.SELECTOR_RULES]: sanitizedRules });
  }

  return sanitizedRules;
}

export async function saveSelectorRules(rules) {
  const sanitizedRules = sanitizeSelectorRules(rules);
  await chrome.storage.local.set({
    [STORAGE_KEYS.SELECTOR_RULES]: sanitizedRules
  });
  return sanitizedRules;
}

export async function ensureSelectorRules() {
  await getSelectorRules();
}

export async function getProviderDiagnostics() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.PROVIDER_DIAGNOSTICS);
  const rawProviderDiagnostics = stored[STORAGE_KEYS.PROVIDER_DIAGNOSTICS];
  const providerDiagnostics = normalizeProviderDiagnostics(rawProviderDiagnostics);

  const needsWriteBack =
    !rawProviderDiagnostics ||
    JSON.stringify(rawProviderDiagnostics) !== JSON.stringify(providerDiagnostics);
  if (needsWriteBack) {
    await saveProviderDiagnostics(providerDiagnostics);
  }

  return providerDiagnostics;
}

export async function saveProviderDiagnostics(providerDiagnostics) {
  const normalized = normalizeProviderDiagnostics(providerDiagnostics);
  await chrome.storage.local.set({
    [STORAGE_KEYS.PROVIDER_DIAGNOSTICS]: normalized
  });
  return normalized;
}

export async function ensureProviderDiagnostics() {
  await getProviderDiagnostics();
}

export async function getQueueItems() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.QUEUE_ITEMS);
  const rawQueueItems = stored[STORAGE_KEYS.QUEUE_ITEMS];
  const queueItems = normalizeQueueItems(rawQueueItems);

  const needsWriteBack =
    !Array.isArray(rawQueueItems) || JSON.stringify(rawQueueItems) !== JSON.stringify(queueItems);
  if (needsWriteBack) {
    await saveQueueItems(queueItems);
  }

  return queueItems;
}

export async function saveQueueItems(queueItems) {
  const normalized = normalizeQueueItems(queueItems);
  await chrome.storage.local.set({
    [STORAGE_KEYS.QUEUE_ITEMS]: normalized
  });
  return normalized;
}

export async function ensureQueueItems() {
  await getQueueItems();
}

export async function getQueueRuntime() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.QUEUE_RUNTIME);
  const rawQueueRuntime = stored[STORAGE_KEYS.QUEUE_RUNTIME];
  const queueRuntime = normalizeQueueRuntime(rawQueueRuntime);

  const needsWriteBack =
    !rawQueueRuntime || JSON.stringify(rawQueueRuntime) !== JSON.stringify(queueRuntime);
  if (needsWriteBack) {
    await saveQueueRuntime(queueRuntime);
  }

  return queueRuntime;
}

export async function saveQueueRuntime(queueRuntime) {
  const normalized = normalizeQueueRuntime(queueRuntime);
  await chrome.storage.local.set({
    [STORAGE_KEYS.QUEUE_RUNTIME]: normalized
  });
  return normalized;
}

export async function ensureQueueRuntime() {
  await getQueueRuntime();
}

function isLegacyAnchorOnlyDefault(rules) {
  if (!Array.isArray(rules) || rules.length !== 1) {
    return false;
  }

  const rule = rules[0];
  if (!rule || typeof rule !== "object") {
    return false;
  }

  const normalizedName = typeof rule.name === "string" ? rule.name.trim().toLowerCase() : "";
  return (
    rule.id === "anchors" &&
    rule.cssSelector === "a[href]" &&
    rule.urlAttribute === "href" &&
    rule.enabled === true &&
    (normalizedName === "all anchor links" || normalizedName === "anchors")
  );
}
