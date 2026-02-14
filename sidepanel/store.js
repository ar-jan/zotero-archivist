import {
  createDefaultQueueRuntimeState,
  normalizeCollectedLinks,
  normalizeQueueItems,
  normalizeQueueRuntime
} from "../shared/state.js";
import {
  createDefaultProviderDiagnostics,
  normalizeProviderDiagnostics
} from "../zotero/provider-interface.js";

export function createPanelStore(initialFilterQuery = "") {
  const state = {
    selectorRulesDirty: false,
    selectorRuleCounter: 0,
    collectedLinks: [],
    queueItems: [],
    queueRuntime: createDefaultQueueRuntimeState(),
    providerDiagnostics: createDefaultProviderDiagnostics(),
    resultsFilterQuery: initialFilterQuery,
    persistCollectedLinksQueue: Promise.resolve(),
    integrationInProgress: false,
    queueAuthoringInProgress: false,
    queueClearingInProgress: false,
    queueLifecycleInProgress: false
  };

  function nextRuleId() {
    state.selectorRuleCounter += 1;
    return `rule-${Date.now()}-${state.selectorRuleCounter}`;
  }

  function isQueueBusy() {
    return (
      state.queueAuthoringInProgress ||
      state.queueClearingInProgress ||
      state.queueLifecycleInProgress
    );
  }

  function isIntegrationBusy() {
    return state.integrationInProgress;
  }

  function enqueueCollectedLinksPersist(run) {
    state.persistCollectedLinksQueue = state.persistCollectedLinksQueue.catch(() => false).then(run);
    return state.persistCollectedLinksQueue;
  }

  return {
    state,
    enqueueCollectedLinksPersist,
    isIntegrationBusy,
    isQueueBusy,
    nextRuleId,
    setCollectedLinks(links) {
      state.collectedLinks = normalizeCollectedLinks(links);
      return state.collectedLinks;
    },
    setProviderDiagnostics(providerDiagnostics) {
      state.providerDiagnostics = normalizeProviderDiagnostics(providerDiagnostics);
      return state.providerDiagnostics;
    },
    setIntegrationInProgress(value) {
      state.integrationInProgress = Boolean(value);
    },
    setQueueAuthoringInProgress(value) {
      state.queueAuthoringInProgress = Boolean(value);
    },
    setQueueClearingInProgress(value) {
      state.queueClearingInProgress = Boolean(value);
    },
    setQueueItems(queueItems) {
      state.queueItems = normalizeQueueItems(queueItems);
      return state.queueItems;
    },
    setQueueLifecycleInProgress(value) {
      state.queueLifecycleInProgress = Boolean(value);
    },
    setQueueRuntime(queueRuntime) {
      state.queueRuntime = normalizeQueueRuntime(queueRuntime);
      return state.queueRuntime;
    },
    setResultsFilterQuery(value) {
      state.resultsFilterQuery = value;
      return state.resultsFilterQuery;
    },
    setSelectorRulesDirty(value) {
      state.selectorRulesDirty = Boolean(value);
      return state.selectorRulesDirty;
    }
  };
}
