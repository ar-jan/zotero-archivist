import { MESSAGE_TYPES, toOriginPattern } from "../shared/protocol.js";

export async function getPanelStateAction() {
  return sendRuntimeMessage(MESSAGE_TYPES.GET_PANEL_STATE);
}

export async function collectLinksAction() {
  return sendRuntimeMessage(MESSAGE_TYPES.COLLECT_LINKS);
}

export async function setCollectedLinksAction(links) {
  return sendRuntimeMessage(MESSAGE_TYPES.SET_COLLECTED_LINKS, {
    links
  });
}

export async function authorQueueFromSelectionAction(links) {
  return sendRuntimeMessage(MESSAGE_TYPES.AUTHOR_QUEUE_FROM_SELECTION, {
    links
  });
}

export async function clearQueueAction() {
  return sendRuntimeMessage(MESSAGE_TYPES.CLEAR_QUEUE);
}

export async function queueLifecycleAction(messageType) {
  return sendRuntimeMessage(messageType);
}

export async function setSelectorRulesAction(rules) {
  return sendRuntimeMessage(MESSAGE_TYPES.SET_SELECTOR_RULES, {
    rules
  });
}

export async function getActiveTabAction() {
  const tabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });
  return tabs[0] ?? null;
}

export async function ensureHostPermissionAction(tabUrl) {
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

async function sendRuntimeMessage(type, payload = undefined) {
  const message = payload === undefined ? { type } : { type, payload };
  return chrome.runtime.sendMessage(message);
}
