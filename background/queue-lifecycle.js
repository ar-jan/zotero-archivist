import { ERROR_CODES, createError, createSuccess } from "../shared/protocol.js";
import { clearQueueRuntimeActive, isQueueItemActiveStatus } from "../shared/state.js";

export function createQueueLifecycleHandlers({
  getQueueRuntime,
  saveQueueRuntime,
  getQueueItems,
  saveQueueItems,
  queueEngine
}) {
  async function clearQueue() {
    const queueRuntime = await getQueueRuntime();
    if (queueRuntime.status === "running") {
      return createError(ERROR_CODES.BAD_REQUEST, "Stop or pause the queue before clearing it.");
    }

    if (Number.isInteger(queueRuntime.activeTabId)) {
      await queueEngine.closeTabIfPresent(queueRuntime.activeTabId);
    }

    await saveQueueItems([]);
    const nextRuntime = {
      ...clearQueueRuntimeActive(queueRuntime),
      status: "idle",
      updatedAt: Date.now()
    };
    await saveQueueRuntime(nextRuntime);

    return createSuccess({
      queueItems: [],
      queueRuntime: nextRuntime
    });
  }

  async function clearArchivedQueue() {
    const queueRuntime = await getQueueRuntime();
    if (queueRuntime.status === "running") {
      return createError(
        ERROR_CODES.BAD_REQUEST,
        "Pause or stop the queue before clearing archived items."
      );
    }

    const queueItems = await getQueueItems();
    const nextQueueItems = queueItems.filter((item) => item.status !== "archived");
    const clearedCount = queueItems.length - nextQueueItems.length;

    if (clearedCount === 0) {
      return createError(ERROR_CODES.BAD_REQUEST, "Queue has no archived items.");
    }

    await saveQueueItems(nextQueueItems);

    return createSuccess({
      queueItems: nextQueueItems,
      queueRuntime,
      clearedCount
    });
  }

  async function startQueue(queueRuntimeContext = undefined) {
    const queueRuntime = await getQueueRuntime();
    if (queueRuntime.status === "running") {
      return createSuccess({
        queueRuntime,
        queueItems: await getQueueItems(),
        alreadyRunning: true
      });
    }

    if (queueRuntime.status === "paused") {
      return createError(ERROR_CODES.BAD_REQUEST, "Queue is paused. Use Resume Queue.");
    }

    const queueItems = await getQueueItems();
    const pendingCount = queueItems.filter((item) => item.status === "pending").length;
    if (pendingCount === 0) {
      return createError(ERROR_CODES.BAD_REQUEST, "Queue has no pending items.");
    }

    const controllerWindowId = normalizeQueueRuntimeContextWindowId(queueRuntimeContext);
    const nextRuntime = {
      ...clearQueueRuntimeActive(queueRuntime),
      status: "running",
      controllerWindowId,
      updatedAt: Date.now()
    };
    await saveQueueRuntime(nextRuntime);
    queueEngine.runQueueEngineSoon("start");

    return createSuccess({
      queueRuntime: nextRuntime,
      queueItems,
      pendingCount
    });
  }

  async function pauseQueue() {
    const queueRuntime = await getQueueRuntime();
    if (queueRuntime.status !== "running") {
      return createError(ERROR_CODES.BAD_REQUEST, "Queue is not running.");
    }

    const nextRuntime = {
      ...queueRuntime,
      status: "paused",
      updatedAt: Date.now()
    };
    await saveQueueRuntime(nextRuntime);
    await queueEngine.clearQueueAlarm();

    return createSuccess({
      queueRuntime: nextRuntime,
      queueItems: await getQueueItems()
    });
  }

  async function resumeQueue(queueRuntimeContext = undefined) {
    const queueRuntime = await getQueueRuntime();
    if (queueRuntime.status !== "paused") {
      return createError(ERROR_CODES.BAD_REQUEST, "Queue is not paused.");
    }

    const queueItems = await getQueueItems();
    const hasPending = queueItems.some((item) => item.status === "pending");
    if (!hasPending && !queueRuntime.activeQueueItemId) {
      return createError(ERROR_CODES.BAD_REQUEST, "Queue has no pending items.");
    }

    const controllerWindowIdFromContext =
      normalizeQueueRuntimeContextWindowId(queueRuntimeContext);
    const persistedControllerWindowId = Number.isInteger(queueRuntime.controllerWindowId)
      ? queueRuntime.controllerWindowId
      : null;

    const nextRuntime = {
      ...queueRuntime,
      status: "running",
      controllerWindowId:
        controllerWindowIdFromContext === null
          ? persistedControllerWindowId
          : controllerWindowIdFromContext,
      updatedAt: Date.now()
    };
    await saveQueueRuntime(nextRuntime);
    queueEngine.runQueueEngineSoon("resume");

    return createSuccess({
      queueRuntime: nextRuntime,
      queueItems
    });
  }

  async function stopQueue() {
    const queueRuntime = await getQueueRuntime();
    const queueItems = await getQueueItems();
    const activeTabId = Number.isInteger(queueRuntime.activeTabId) ? queueRuntime.activeTabId : null;

    let nextQueueItems = queueItems;
    if (typeof queueRuntime.activeQueueItemId === "string") {
      const activeIndex = nextQueueItems.findIndex((item) => item.id === queueRuntime.activeQueueItemId);
      if (activeIndex >= 0 && isQueueItemActiveStatus(nextQueueItems[activeIndex].status)) {
        nextQueueItems = [...nextQueueItems];
        nextQueueItems[activeIndex] = {
          ...nextQueueItems[activeIndex],
          status: "cancelled",
          lastError: "Queue was stopped before completion.",
          updatedAt: Date.now()
        };
        await saveQueueItems(nextQueueItems);
      }
    }

    const nextRuntime = {
      ...clearQueueRuntimeActive(queueRuntime),
      status: "idle",
      updatedAt: Date.now()
    };
    await saveQueueRuntime(nextRuntime);
    await queueEngine.clearQueueAlarm();
    if (activeTabId !== null) {
      await queueEngine.closeTabIfPresent(activeTabId);
    }

    return createSuccess({
      queueRuntime: nextRuntime,
      queueItems: nextQueueItems
    });
  }

  async function retryFailedQueue() {
    const queueRuntime = await getQueueRuntime();
    if (queueRuntime.status === "running") {
      return createError(ERROR_CODES.BAD_REQUEST, "Pause or stop the queue before retrying items.");
    }

    const queueItems = await getQueueItems();
    let retriedCount = 0;
    const nextQueueItems = queueItems.map((item) => {
      if (item.status !== "failed" && item.status !== "cancelled") {
        return item;
      }

      retriedCount += 1;
      return {
        ...item,
        status: "pending",
        updatedAt: Date.now(),
        lastError: undefined
      };
    });

    if (retriedCount === 0) {
      return createError(ERROR_CODES.BAD_REQUEST, "Queue has no failed or cancelled items.");
    }

    await saveQueueItems(nextQueueItems);

    return createSuccess({
      queueItems: nextQueueItems,
      queueRuntime,
      retriedCount
    });
  }

  async function reverseQueue() {
    const queueRuntime = await getQueueRuntime();
    if (queueRuntime.status === "running") {
      return createError(ERROR_CODES.BAD_REQUEST, "Pause or stop the queue before reversing it.");
    }

    const queueItems = await getQueueItems();
    if (queueItems.length < 2) {
      return createError(ERROR_CODES.BAD_REQUEST, "Queue needs at least two items to reverse.");
    }

    const nextQueueItems = [...queueItems].reverse();
    await saveQueueItems(nextQueueItems);

    return createSuccess({
      queueItems: nextQueueItems,
      queueRuntime
    });
  }

  return {
    clearQueue,
    clearArchivedQueue,
    pauseQueue,
    resumeQueue,
    reverseQueue,
    retryFailedQueue,
    startQueue,
    stopQueue
  };
}

function normalizeQueueRuntimeContextWindowId(queueRuntimeContext) {
  if (!queueRuntimeContext || typeof queueRuntimeContext !== "object") {
    return null;
  }

  return Number.isInteger(queueRuntimeContext.controllerWindowId)
    ? queueRuntimeContext.controllerWindowId
    : null;
}
