import { MESSAGE_TYPES } from "../shared/protocol.js";

const QUEUE_LIFECYCLE_CONFIG = Object.freeze({
  [MESSAGE_TYPES.START_QUEUE]: Object.freeze({
    fallbackErrorMessage: "Failed to start queue.",
    successStatusMessage: "Queue started."
  }),
  [MESSAGE_TYPES.PAUSE_QUEUE]: Object.freeze({
    fallbackErrorMessage: "Failed to pause queue.",
    successStatusMessage: "Queue paused."
  }),
  [MESSAGE_TYPES.RESUME_QUEUE]: Object.freeze({
    fallbackErrorMessage: "Failed to resume queue.",
    successStatusMessage: "Queue resumed."
  }),
  [MESSAGE_TYPES.STOP_QUEUE]: Object.freeze({
    fallbackErrorMessage: "Failed to stop queue.",
    successStatusMessage: "Queue stopped."
  }),
  [MESSAGE_TYPES.RETRY_FAILED_QUEUE]: Object.freeze({
    fallbackErrorMessage: "Failed to retry queue items.",
    successStatusMessage: "Retry queued for failed items."
  }),
  [MESSAGE_TYPES.REVERSE_QUEUE]: Object.freeze({
    fallbackErrorMessage: "Failed to reverse queue order.",
    successStatusMessage: "Queue order reversed."
  })
});

export function createQueueController({
  panelStore,
  getCollectedLinks,
  getQueueItems,
  getQueueRuntime,
  getQueueRuntimeContext,
  queueLifecycleActionImpl,
  ensureHostPermissionsForUrlsActionImpl,
  authorQueueFromSelectionActionImpl,
  clearQueueActionImpl,
  clearArchivedQueueActionImpl,
  setQueueItemsState,
  setQueueRuntimeState,
  updateQueueActionState,
  setStatus,
  messageFromError,
  logger = console
}) {
  async function startQueueProcessing() {
    await runQueueLifecycleAction(MESSAGE_TYPES.START_QUEUE);
  }

  async function pauseQueueProcessing() {
    await runQueueLifecycleAction(MESSAGE_TYPES.PAUSE_QUEUE);
  }

  async function resumeQueueProcessing() {
    await runQueueLifecycleAction(MESSAGE_TYPES.RESUME_QUEUE);
  }

  async function stopQueueProcessing() {
    await runQueueLifecycleAction(MESSAGE_TYPES.STOP_QUEUE);
  }

  async function retryFailedQueueItems() {
    await runQueueLifecycleAction(MESSAGE_TYPES.RETRY_FAILED_QUEUE);
  }

  async function reverseQueueItems() {
    await runQueueLifecycleAction(MESSAGE_TYPES.REVERSE_QUEUE);
  }

  async function runQueueLifecycleAction(messageType) {
    const config = QUEUE_LIFECYCLE_CONFIG[messageType];
    if (!config) {
      setStatus("Unsupported queue action.");
      return;
    }

    panelStore.setQueueLifecycleInProgress(true);
    updateQueueActionState();

    try {
      const permissionPreflightResult = await ensureQueueHostPermissionsForLifecycleAction(messageType);
      if (!permissionPreflightResult.ok) {
        setStatus(permissionPreflightResult.message);
        return;
      }

      const queueRuntimeContext = await resolveQueueRuntimeContextForLifecycleAction({
        messageType,
        getQueueRuntimeContext
      });
      const queueLifecyclePayload = queueRuntimeContext
        ? { queueRuntimeContext }
        : undefined;
      const response = await queueLifecycleActionImpl(messageType, queueLifecyclePayload);

      if (!response || response.ok !== true) {
        setStatus(resolveErrorMessage(response?.error, messageFromError) ?? config.fallbackErrorMessage);
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

      setStatus(config.successStatusMessage);
    } catch (error) {
      logger.error("[webpage-archivist] Queue lifecycle action failed.", {
        messageType,
        error
      });
      setStatus(config.fallbackErrorMessage);
    } finally {
      panelStore.setQueueLifecycleInProgress(false);
      updateQueueActionState();
    }
  }

  async function ensureQueueHostPermissionsForLifecycleAction(messageType) {
    if (
      messageType !== MESSAGE_TYPES.START_QUEUE &&
      messageType !== MESSAGE_TYPES.RESUME_QUEUE
    ) {
      return { ok: true };
    }

    if (typeof ensureHostPermissionsForUrlsActionImpl !== "function") {
      return { ok: true };
    }

    const permissionCandidateUrls = getQueuePermissionCandidateUrls({
      queueItems: getQueueItems(),
      queueRuntime: typeof getQueueRuntime === "function" ? getQueueRuntime() : null
    });

    if (permissionCandidateUrls.length === 0) {
      return { ok: true };
    }

    setStatus("Checking host permissions for queued links...");

    let permissionResult;
    try {
      permissionResult = await ensureHostPermissionsForUrlsActionImpl(permissionCandidateUrls);
    } catch (_error) {
      return {
        ok: false,
        message: "Failed to verify host permissions for queued links."
      };
    }

    if (permissionResult?.granted === true) {
      return { ok: true };
    }

    const requestedOriginsCount = Array.isArray(permissionResult?.requestedOrigins)
      ? permissionResult.requestedOrigins.length
      : 0;

    return {
      ok: false,
      message:
        requestedOriginsCount > 1
          ? "Permission was not granted for one or more queued sites."
          : "Permission was not granted for the queued site."
    };
  }

  async function addSelectedLinksToQueue() {
    const selectedLinks = getCollectedLinks().filter((link) => link.selected !== false);
    if (selectedLinks.length === 0) {
      setStatus("Select at least one link to add to queue.");
      return;
    }

    panelStore.setQueueAuthoringInProgress(true);
    updateQueueActionState();

    try {
      const response = await authorQueueFromSelectionActionImpl(selectedLinks);

      if (!response || response.ok !== true) {
        setStatus(
          resolveErrorMessage(response?.error, messageFromError) ??
            "Failed to add selected links to queue."
        );
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
      logger.error("[webpage-archivist] Failed to add selected links to queue.", error);
      setStatus("Failed to add selected links to queue.");
    } finally {
      panelStore.setQueueAuthoringInProgress(false);
      updateQueueActionState();
    }
  }

  async function clearQueueItems() {
    if (getQueueItems().length === 0) {
      setStatus("Queue is already empty.");
      return;
    }

    panelStore.setQueueClearingInProgress(true);
    updateQueueActionState();

    try {
      const response = await clearQueueActionImpl();

      if (!response || response.ok !== true) {
        setStatus(resolveErrorMessage(response?.error, messageFromError) ?? "Failed to clear queue.");
        return;
      }

      setQueueItemsState(response.queueItems);
      if (response.queueRuntime) {
        setQueueRuntimeState(response.queueRuntime);
      }
      setStatus("Cleared queue.");
    } catch (error) {
      logger.error("[webpage-archivist] Failed to clear queue.", error);
      setStatus("Failed to clear queue.");
    } finally {
      panelStore.setQueueClearingInProgress(false);
      updateQueueActionState();
    }
  }

  async function removeQueueItem(queueItemId) {
    const normalizedQueueItemId =
      typeof queueItemId === "string" ? queueItemId.trim() : "";
    if (normalizedQueueItemId.length === 0) {
      setStatus("Queue item id is required.");
      return;
    }

    panelStore.setQueueClearingInProgress(true);
    updateQueueActionState();

    try {
      const response = await queueLifecycleActionImpl(MESSAGE_TYPES.REMOVE_QUEUE_ITEM, {
        queueItem: {
          id: normalizedQueueItemId
        }
      });

      if (!response || response.ok !== true) {
        setStatus(resolveErrorMessage(response?.error, messageFromError) ?? "Failed to remove queue item.");
        return;
      }

      setQueueItemsState(response.queueItems);
      if (response.queueRuntime) {
        setQueueRuntimeState(response.queueRuntime);
      }
      setStatus("Removed queue item.");
    } catch (error) {
      logger.error("[webpage-archivist] Failed to remove queue item.", error);
      setStatus("Failed to remove queue item.");
    } finally {
      panelStore.setQueueClearingInProgress(false);
      updateQueueActionState();
    }
  }

  async function clearArchivedQueueItems() {
    const archivedCount = getQueueItems().filter((item) => item.status === "archived").length;
    if (archivedCount === 0) {
      setStatus("Queue has no archived items.");
      return;
    }

    panelStore.setQueueClearingInProgress(true);
    updateQueueActionState();

    try {
      const response = await clearArchivedQueueActionImpl();

      if (!response || response.ok !== true) {
        setStatus(
          resolveErrorMessage(response?.error, messageFromError) ??
            "Failed to clear archived queue items."
        );
        return;
      }

      setQueueItemsState(response.queueItems);
      if (response.queueRuntime) {
        setQueueRuntimeState(response.queueRuntime);
      }

      const clearedCount = Number.isFinite(response.clearedCount)
        ? response.clearedCount
        : archivedCount;
      setStatus(`Cleared ${clearedCount} archived item(s).`);
    } catch (error) {
      logger.error("[webpage-archivist] Failed to clear archived queue items.", error);
      setStatus("Failed to clear archived queue items.");
    } finally {
      panelStore.setQueueClearingInProgress(false);
      updateQueueActionState();
    }
  }

  return {
    startQueueProcessing,
    pauseQueueProcessing,
    resumeQueueProcessing,
    stopQueueProcessing,
    retryFailedQueueItems,
    reverseQueueItems,
    addSelectedLinksToQueue,
    removeQueueItem,
    clearQueueItems,
    clearArchivedQueueItems
  };
}

async function resolveQueueRuntimeContextForLifecycleAction({
  messageType,
  getQueueRuntimeContext
}) {
  if (!isQueueRuntimeContextLifecycleAction(messageType)) {
    return null;
  }

  if (typeof getQueueRuntimeContext !== "function") {
    return null;
  }

  let queueRuntimeContext;
  try {
    queueRuntimeContext = await getQueueRuntimeContext();
  } catch (_error) {
    return null;
  }

  if (!queueRuntimeContext || typeof queueRuntimeContext !== "object") {
    return null;
  }

  if (!Number.isInteger(queueRuntimeContext.controllerWindowId)) {
    return null;
  }

  return {
    controllerWindowId: queueRuntimeContext.controllerWindowId
  };
}

function isQueueRuntimeContextLifecycleAction(messageType) {
  return messageType === MESSAGE_TYPES.START_QUEUE || messageType === MESSAGE_TYPES.RESUME_QUEUE;
}

function resolveErrorMessage(error, messageFromError) {
  if (typeof messageFromError !== "function") {
    return null;
  }

  return messageFromError(error);
}

function getQueuePermissionCandidateUrls({ queueItems, queueRuntime }) {
  if (!Array.isArray(queueItems) || queueItems.length === 0) {
    return [];
  }

  const candidateUrls = [];
  const seenUrls = new Set();
  for (const queueItem of queueItems) {
    if (!queueItem || queueItem.status !== "pending" || typeof queueItem.url !== "string") {
      continue;
    }

    const normalizedUrl = queueItem.url.trim();
    if (normalizedUrl.length === 0) {
      continue;
    }

    const dedupeKey = normalizedUrl.toLowerCase();
    if (seenUrls.has(dedupeKey)) {
      continue;
    }

    seenUrls.add(dedupeKey);
    candidateUrls.push(normalizedUrl);
  }

  if (typeof queueRuntime?.activeQueueItemId === "string" && queueRuntime.activeQueueItemId.length > 0) {
    const activeQueueItem = queueItems.find((item) => item.id === queueRuntime.activeQueueItemId);
    if (activeQueueItem && typeof activeQueueItem.url === "string") {
      const activeUrl = activeQueueItem.url.trim();
      const dedupeKey = activeUrl.toLowerCase();
      if (activeUrl.length > 0 && !seenUrls.has(dedupeKey)) {
        seenUrls.add(dedupeKey);
        candidateUrls.push(activeUrl);
      }
    }
  }

  return candidateUrls;
}
