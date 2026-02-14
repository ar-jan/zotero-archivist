import { isHttpUrl } from "./protocol.js";

export const QUEUE_ITEM_STATUSES = Object.freeze([
  "pending",
  "opening_tab",
  "saving_snapshot",
  "archived",
  "failed",
  "cancelled"
]);

export const QUEUE_RUNTIME_STATUSES = Object.freeze(["idle", "running", "paused"]);

const QUEUE_ITEM_STATUS_SET = new Set(QUEUE_ITEM_STATUSES);
const QUEUE_RUNTIME_STATUS_SET = new Set(QUEUE_RUNTIME_STATUSES);
const QUEUE_ACTIVE_ITEM_STATUS_SET = new Set(["opening_tab", "saving_snapshot"]);

export function createDefaultQueueRuntimeState(now = Date.now()) {
  return {
    status: "idle",
    activeQueueItemId: null,
    activeTabId: null,
    updatedAt: now
  };
}

export function normalizeCollectedLinks(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  const seenDedupeKeys = new Set();
  const seenIds = new Set();
  const normalized = [];
  for (const candidate of input) {
    if (!candidate || typeof candidate !== "object" || typeof candidate.url !== "string") {
      continue;
    }

    if (!isHttpUrl(candidate.url)) {
      continue;
    }

    let url;
    try {
      url = new URL(candidate.url).toString();
    } catch (_error) {
      continue;
    }

    const dedupeKey =
      typeof candidate.dedupeKey === "string" && candidate.dedupeKey.length > 0
        ? candidate.dedupeKey
        : url.toLowerCase();

    if (seenDedupeKeys.has(dedupeKey)) {
      continue;
    }
    seenDedupeKeys.add(dedupeKey);

    const candidateId =
      typeof candidate.id === "string" && candidate.id.trim().length > 0 ? candidate.id.trim() : "";
    const fallbackId = `link-${normalized.length + 1}`;
    const id = candidateId.length > 0 && !seenIds.has(candidateId) ? candidateId : fallbackId;
    seenIds.add(id);

    normalized.push({
      id,
      url,
      title:
        typeof candidate.title === "string" && candidate.title.trim().length > 0
          ? candidate.title.trim()
          : url,
      sourceSelectorId:
        typeof candidate.sourceSelectorId === "string" && candidate.sourceSelectorId.length > 0
          ? candidate.sourceSelectorId
          : "unknown",
      selected: candidate.selected !== false,
      dedupeKey
    });
  }

  return normalized;
}

export function normalizeQueueStatus(status) {
  if (typeof status === "string" && QUEUE_ITEM_STATUS_SET.has(status)) {
    return status;
  }
  return "pending";
}

export function normalizeQueueItems(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  const now = Date.now();
  const seenUrls = new Set();
  const normalized = [];
  for (const candidate of input) {
    if (!candidate || typeof candidate !== "object" || typeof candidate.url !== "string") {
      continue;
    }

    if (!isHttpUrl(candidate.url)) {
      continue;
    }

    let url;
    try {
      url = new URL(candidate.url).toString();
    } catch (_error) {
      continue;
    }

    const dedupeKey = url.toLowerCase();
    if (seenUrls.has(dedupeKey)) {
      continue;
    }
    seenUrls.add(dedupeKey);

    const createdAt =
      Number.isFinite(candidate.createdAt) && candidate.createdAt > 0
        ? Math.trunc(candidate.createdAt)
        : now;
    const updatedAt =
      Number.isFinite(candidate.updatedAt) && candidate.updatedAt > 0
        ? Math.max(Math.trunc(candidate.updatedAt), createdAt)
        : createdAt;

    const queueItem = {
      id:
        typeof candidate.id === "string" && candidate.id.trim().length > 0
          ? candidate.id.trim()
          : createQueueItemId(now, normalized.length + 1),
      url,
      title:
        typeof candidate.title === "string" && candidate.title.trim().length > 0
          ? candidate.title.trim()
          : url,
      status: normalizeQueueStatus(candidate.status),
      attempts:
        Number.isFinite(candidate.attempts) && candidate.attempts >= 0
          ? Math.trunc(candidate.attempts)
          : 0,
      createdAt,
      updatedAt
    };

    if (typeof candidate.lastError === "string" && candidate.lastError.trim().length > 0) {
      queueItem.lastError = candidate.lastError.trim();
    }

    normalized.push(queueItem);
  }

  return normalized;
}

export function normalizeQueueRuntime(input) {
  const now = Date.now();
  if (!input || typeof input !== "object") {
    return createDefaultQueueRuntimeState(now);
  }

  const status =
    typeof input.status === "string" && QUEUE_RUNTIME_STATUS_SET.has(input.status)
      ? input.status
      : "idle";

  const activeQueueItemId =
    typeof input.activeQueueItemId === "string" && input.activeQueueItemId.length > 0
      ? input.activeQueueItemId
      : null;
  const activeTabId = Number.isInteger(input.activeTabId) ? input.activeTabId : null;

  const updatedAt =
    Number.isFinite(input.updatedAt) && input.updatedAt > 0 ? Math.trunc(input.updatedAt) : now;

  if (status === "idle" || activeQueueItemId === null || activeTabId === null) {
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

export function markQueueItemFailed(queueItem, message) {
  return {
    ...queueItem,
    status: "failed",
    lastError: message,
    updatedAt: Date.now()
  };
}

export function createQueueItemId(timestamp, index) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `queue-${crypto.randomUUID()}`;
  }
  return `queue-${timestamp}-${index}`;
}

export function clearQueueRuntimeActive(queueRuntime) {
  return {
    ...queueRuntime,
    activeQueueItemId: null,
    activeTabId: null
  };
}

export function isQueueItemActiveStatus(status) {
  return QUEUE_ACTIVE_ITEM_STATUS_SET.has(status);
}

export function getQueueItemCounts(queueItems) {
  const safeQueueItems = Array.isArray(queueItems) ? queueItems : [];
  const pendingCount = safeQueueItems.filter((item) => item.status === "pending").length;
  const archivedCount = safeQueueItems.filter((item) => item.status === "archived").length;
  const failedCount = safeQueueItems.filter((item) => item.status === "failed").length;
  const cancelledCount = safeQueueItems.filter((item) => item.status === "cancelled").length;
  return {
    pendingCount,
    archivedCount,
    failedCount,
    cancelledCount,
    retriableCount: failedCount + cancelledCount
  };
}
