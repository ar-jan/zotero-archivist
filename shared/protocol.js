export const MESSAGE_TYPES = Object.freeze({
  GET_PANEL_STATE: "GET_PANEL_STATE",
  COLLECT_LINKS: "COLLECT_LINKS",
  SET_COLLECTED_LINKS: "SET_COLLECTED_LINKS",
  AUTHOR_QUEUE_FROM_SELECTION: "AUTHOR_QUEUE_FROM_SELECTION",
  CLEAR_QUEUE: "CLEAR_QUEUE",
  START_QUEUE: "START_QUEUE",
  PAUSE_QUEUE: "PAUSE_QUEUE",
  RESUME_QUEUE: "RESUME_QUEUE",
  STOP_QUEUE: "STOP_QUEUE",
  RETRY_FAILED_QUEUE: "RETRY_FAILED_QUEUE",
  SET_SELECTOR_RULES: "SET_SELECTOR_RULES",
  RUN_COLLECTOR: "RUN_COLLECTOR"
});

export const STORAGE_KEYS = Object.freeze({
  SELECTOR_RULES: "selectorRules",
  COLLECTED_LINKS: "collectedLinks",
  COLLECTOR_SETTINGS: "collectorSettings",
  QUEUE_SETTINGS: "queueSettings",
  QUEUE_ITEMS: "queueItems",
  QUEUE_RUNTIME: "queueRuntime",
  PROVIDER_DIAGNOSTICS: "providerDiagnostics"
});

export const ERROR_CODES = Object.freeze({
  BAD_REQUEST: "BAD_REQUEST",
  INVALID_SELECTOR_RULES: "INVALID_SELECTOR_RULES",
  NO_ACTIVE_TAB: "NO_ACTIVE_TAB",
  UNSUPPORTED_URL: "UNSUPPORTED_URL",
  MISSING_HOST_PERMISSION: "MISSING_HOST_PERMISSION",
  COLLECTOR_ERROR: "COLLECTOR_ERROR",
  QUEUE_ITEM_NOT_FOUND: "QUEUE_ITEM_NOT_FOUND",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  INTERNAL_ERROR: "INTERNAL_ERROR"
});

export const SAVE_PROVIDER_MODES = Object.freeze({
  CONNECTOR_BRIDGE: "connector_bridge"
});

export const DEFAULT_SELECTOR_RULES = Object.freeze([
  Object.freeze({
    id: "substack-posts",
    name: "Substack posts",
    cssSelector: 'a[data-testid="post-preview-title"]',
    urlAttribute: "href",
    enabled: true
  }),
  Object.freeze({
    id: "anchors",
    name: "All anchor links",
    cssSelector: "a[href]",
    urlAttribute: "href",
    enabled: false
  })
]);

export function createSuccess(payload = {}) {
  return {
    ok: true,
    ...payload
  };
}

export function createError(code, message, details = undefined) {
  return {
    ok: false,
    error: {
      code,
      message,
      details
    }
  };
}

export function sanitizeSelectorRules(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  const sanitizedRules = [];
  const seenIds = new Set();
  for (const rule of input) {
    if (!rule || typeof rule !== "object") {
      continue;
    }

    if (typeof rule.id !== "string" || rule.id.trim().length === 0) {
      continue;
    }

    const id = rule.id.trim();
    if (seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);

    if (typeof rule.cssSelector !== "string" || rule.cssSelector.trim().length === 0) {
      continue;
    }

    const sanitizedRule = {
      id,
      name: typeof rule.name === "string" && rule.name.trim().length > 0 ? rule.name.trim() : id,
      cssSelector: rule.cssSelector.trim(),
      urlAttribute:
        typeof rule.urlAttribute === "string" && rule.urlAttribute.trim().length > 0
          ? rule.urlAttribute.trim()
          : "href",
      enabled: rule.enabled !== false
    };

    if (typeof rule.includePattern === "string" && rule.includePattern.trim().length > 0) {
      sanitizedRule.includePattern = rule.includePattern.trim();
    }

    if (typeof rule.excludePattern === "string" && rule.excludePattern.trim().length > 0) {
      sanitizedRule.excludePattern = rule.excludePattern.trim();
    }

    sanitizedRules.push(sanitizedRule);
  }

  return sanitizedRules;
}

export function isHttpUrl(url) {
  if (typeof url !== "string" || url.length === 0) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (_error) {
    return false;
  }
}

export function toOriginPattern(url) {
  if (!isHttpUrl(url)) {
    return null;
  }

  const parsed = new URL(url);
  return `${parsed.origin}/*`;
}
