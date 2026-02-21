import { SAVE_PROVIDER_MODES } from "../shared/protocol.js";
import {
  createProviderSaveSuccess,
  createProviderSaveError
} from "./provider-interface.js";

const CONNECTOR_EXTENSION_ID = "ekhagklcjbdpajgpjgmbionohlpdbjgc";
const CONNECTOR_BRIDGE_IFRAME_PATH = "chromeMessageIframe/messageIframe.html";
const BRIDGE_HEALTH_TIMEOUT_MS = 4000;
const BRIDGE_SAVE_TIMEOUT_MS = 120000;
const BRIDGE_DEFAULT_FRAME_TIMEOUT_MS = 8000;
const CONNECTOR_OFFLINE_SAVE_MESSAGE =
  "Zotero Connector reports the local Zotero client as offline for bridge save.";
const CONNECTOR_HEALTHY_MESSAGE =
  "Zotero Connector is available and reports the Zotero app as online.";
const CONNECTOR_OFFLINE_HEALTH_MESSAGE =
  "Zotero Connector is available, but reports the Zotero app as offline.";
const CONNECTOR_EXTENSION_UNAVAILABLE_MESSAGE =
  "Zotero Connector extension is unavailable. Ensure it is installed and enabled.";
const CONNECTOR_PROBE_TAB_REQUIRED_MESSAGE =
  "Connector probe requires an open http(s) tab with granted site access.";

export function createConnectorBridgeProvider() {
  return {
    mode: SAVE_PROVIDER_MODES.CONNECTOR_BRIDGE,
    async checkHealth(input = {}) {
      const probeTarget = await resolveBridgeProbeTarget(input?.tabId);
      if (!probeTarget.ok) {
        return createConnectorHealthResult({
          ok: false,
          message: probeTarget.message,
          bridgeReady: false,
          connectorAvailable: null,
          zoteroOnline: null
        });
      }

      const probeResult = await runBridgeCommand({
        tabId: probeTarget.tabId,
        timeoutMs: BRIDGE_HEALTH_TIMEOUT_MS,
        command: ["Connector.checkIsOnline", []]
      });
      if (!probeResult.ok) {
        if (isConnectorUnavailableError(probeResult.error)) {
          return createConnectorHealthResult({
            ok: false,
            message: CONNECTOR_EXTENSION_UNAVAILABLE_MESSAGE,
            bridgeReady: false,
            connectorAvailable: false,
            zoteroOnline: null
          });
        }

        return createConnectorHealthResult({
          ok: false,
          message: `Connector bridge probe failed: ${probeResult.error}`,
          bridgeReady: false,
          connectorAvailable: true,
          zoteroOnline: null
        });
      }

      if (probeResult.result !== true) {
        return createConnectorHealthResult({
          ok: false,
          message: CONNECTOR_OFFLINE_HEALTH_MESSAGE,
          bridgeReady: true,
          connectorAvailable: true,
          zoteroOnline: false
        });
      }

      return createConnectorHealthResult({
        ok: true,
        message: CONNECTOR_HEALTHY_MESSAGE,
        bridgeReady: true,
        connectorAvailable: true,
        zoteroOnline: true
      });
    },
    async saveWebPageWithSnapshot(input) {
      if (!Number.isInteger(input?.tabId)) {
        return createProviderSaveError("Connector bridge requires a valid tab id.");
      }

      let tab;
      try {
        tab = await chrome.tabs.get(input.tabId);
      } catch (error) {
        return createProviderSaveError(`Failed to resolve queue tab for connector bridge: ${String(error)}`);
      }

      const tabPayload = {
        id: tab.id,
        url:
          typeof tab.url === "string" && tab.url.length > 0
            ? tab.url
            : typeof input.url === "string" && input.url.length > 0
              ? input.url
              : undefined,
        title:
          typeof input.title === "string" && input.title.trim().length > 0
            ? input.title.trim()
            : typeof tab.title === "string" && tab.title.trim().length > 0
              ? tab.title.trim()
                : typeof input.url === "string" && input.url.length > 0
                  ? input.url
                  : "Untitled"
      };

      const injectionResult = await runBridgeCommand({
        tabId: input.tabId,
        timeoutMs: BRIDGE_HEALTH_TIMEOUT_MS,
        command: ["Connector_Browser.injectTranslationScripts", [tabPayload, 0]]
      });
      if (!injectionResult.ok) {
        return createProviderSaveError(
          `Connector bridge could not prepare translation scripts: ${injectionResult.error}`
        );
      }

      const onlineResult = await runBridgeCommand({
        tabId: input.tabId,
        timeoutMs: BRIDGE_HEALTH_TIMEOUT_MS,
        command: ["Connector.checkIsOnline", []]
      });
      if (!onlineResult.ok) {
        return createProviderSaveError(`Connector bridge online check failed: ${onlineResult.error}`);
      }
      if (onlineResult.result !== true) {
        return createProviderSaveError(CONNECTOR_OFFLINE_SAVE_MESSAGE);
      }

      const saveResult = await runBridgeCommand({
        tabId: input.tabId,
        timeoutMs: BRIDGE_SAVE_TIMEOUT_MS,
        command: [
          "Messaging.sendMessage",
          ["saveAsWebpage", [tabPayload.title, { snapshot: true }], tabPayload.id, 0]
        ]
      });
      if (!saveResult.ok) {
        return createProviderSaveError(`Connector bridge save failed: ${saveResult.error}`);
      }

      return createProviderSaveSuccess();
    }
  };
}

function createConnectorHealthResult({
  ok,
  message,
  bridgeReady = null,
  connectorAvailable = null,
  zoteroOnline = null
}) {
  return {
    ok,
    message,
    bridgeReady,
    connectorAvailable,
    zoteroOnline
  };
}

async function resolveBridgeProbeTarget(preferredTabId) {
  if (Number.isInteger(preferredTabId)) {
    return resolveProbeTargetFromTabId(preferredTabId);
  }

  const candidateTabs = await listProbeCandidateTabs();
  for (const tab of candidateTabs) {
    if (await canUseTabForBridgeProbe(tab)) {
      return {
        ok: true,
        tabId: tab.id
      };
    }
  }

  return {
    ok: false,
    message: CONNECTOR_PROBE_TAB_REQUIRED_MESSAGE
  };
}

async function resolveProbeTargetFromTabId(tabId) {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (_error) {
    return {
      ok: false,
      message: "Connector probe tab is no longer available."
    };
  }

  if (!isHttpProbeUrl(tab?.url)) {
    return {
      ok: false,
      message: "Connector probe tab must use an http(s) URL."
    };
  }

  const hasPermission = await hasHostPermissionForUrl(tab.url);
  if (!hasPermission) {
    return {
      ok: false,
      message: "Connector probe tab does not currently have granted site access."
    };
  }

  return {
    ok: true,
    tabId
  };
}

async function listProbeCandidateTabs() {
  let focusedActiveTabs = [];
  let activeTabs = [];
  let httpTabs = [];

  try {
    focusedActiveTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  } catch (_error) {
    focusedActiveTabs = [];
  }

  try {
    activeTabs = await chrome.tabs.query({ active: true });
  } catch (_error) {
    activeTabs = [];
  }

  try {
    httpTabs = await chrome.tabs.query({
      url: ["http://*/*", "https://*/*"]
    });
  } catch (_error) {
    httpTabs = [];
  }

  const seenTabIds = new Set();
  const dedupedTabs = [];
  for (const tab of [...focusedActiveTabs, ...activeTabs, ...httpTabs]) {
    if (!Number.isInteger(tab?.id) || seenTabIds.has(tab.id)) {
      continue;
    }
    seenTabIds.add(tab.id);
    dedupedTabs.push(tab);
  }

  return dedupedTabs;
}

async function canUseTabForBridgeProbe(tab) {
  if (!Number.isInteger(tab?.id)) {
    return false;
  }

  if (!isHttpProbeUrl(tab?.url)) {
    return false;
  }

  return hasHostPermissionForUrl(tab.url);
}

function isHttpProbeUrl(url) {
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

async function hasHostPermissionForUrl(url) {
  const originPattern = toOriginPattern(url);
  if (!originPattern) {
    return false;
  }

  try {
    return await chrome.permissions.contains({
      origins: [originPattern]
    });
  } catch (_error) {
    return false;
  }
}

function toOriginPattern(url) {
  if (!isHttpProbeUrl(url)) {
    return null;
  }

  try {
    const parsed = new URL(url);
    return `${parsed.origin}/*`;
  } catch (_error) {
    return null;
  }
}

function isConnectorUnavailableError(errorMessage) {
  if (typeof errorMessage !== "string" || errorMessage.length === 0) {
    return false;
  }

  const normalized = errorMessage.toLowerCase();
  if (normalized.includes("unable to load zotero connector bridge iframe")) {
    return true;
  }
  if (normalized.includes("timed out while loading zotero connector bridge iframe")) {
    return true;
  }
  if (normalized.includes("could not establish connection. receiving end does not exist")) {
    return true;
  }
  if (normalized.includes("timed out while opening connector bridge channel")) {
    return true;
  }

  return false;
}

async function runBridgeCommand({ tabId, timeoutMs, command }) {
  if (!Number.isInteger(tabId)) {
    return {
      ok: false,
      error: "Bridge command requires a valid tab id."
    };
  }

  if (!Array.isArray(command) || command.length !== 2) {
    return {
      ok: false,
      error: "Bridge command payload is invalid."
    };
  }

  const commandName = command[0];
  const commandArgs = command[1];
  if (typeof commandName !== "string" || !Array.isArray(commandArgs)) {
    return {
      ok: false,
      error: "Bridge command name or args are invalid."
    };
  }

  let injectionResult;
  try {
    const workerCommand = [commandName, commandArgs, tabId, 0];
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: executeConnectorBridgeCommandInTab,
      args: [
        {
          connectorExtensionId: CONNECTOR_EXTENSION_ID,
          connectorBridgeIframePath: CONNECTOR_BRIDGE_IFRAME_PATH,
          timeoutMs: normalizeTimeoutMs(timeoutMs),
          workerCommand
        }
      ]
    });
    injectionResult = result?.[0]?.result;
  } catch (error) {
    return {
      ok: false,
      error: `Failed to run connector bridge script in tab: ${String(error)}`
    };
  }

  if (!injectionResult || typeof injectionResult !== "object") {
    return {
      ok: false,
      error: "Connector bridge returned an invalid response."
    };
  }

  if (injectionResult.ok !== true) {
    return {
      ok: false,
      error:
        typeof injectionResult.error === "string" && injectionResult.error.length > 0
          ? injectionResult.error
          : "Connector bridge command failed."
    };
  }

  return {
    ok: true,
    result: injectionResult.result
  };
}

function normalizeTimeoutMs(timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return BRIDGE_DEFAULT_FRAME_TIMEOUT_MS;
  }

  return Math.max(1000, Math.trunc(timeoutMs));
}

async function executeConnectorBridgeCommandInTab(input) {
  const connectorExtensionId =
    typeof input?.connectorExtensionId === "string" ? input.connectorExtensionId.trim() : "";
  const connectorBridgeIframePath =
    typeof input?.connectorBridgeIframePath === "string"
      ? input.connectorBridgeIframePath.trim()
      : "chromeMessageIframe/messageIframe.html";
  const timeoutMs =
    Number.isFinite(input?.timeoutMs) && input.timeoutMs > 0 ? Math.trunc(input.timeoutMs) : 8000;
  const workerCommand = Array.isArray(input?.workerCommand) ? input.workerCommand : null;

  if (!connectorExtensionId || !workerCommand || workerCommand.length < 2) {
    return {
      ok: false,
      error: "Connector bridge invocation parameters are invalid."
    };
  }

  const iframeUrl = `chrome-extension://${connectorExtensionId}/${connectorBridgeIframePath}`;
  let iframe;
  let port;

  try {
    iframe = await loadBridgeFrame(iframeUrl, timeoutMs);
    port = await initializeBridgePort(iframe, timeoutMs);

    const responsePayload = await sendBridgeMessage(port, "sendToBackground", [
      workerCommand
    ], timeoutMs);

    if (Array.isArray(responsePayload) && responsePayload[0] === "error") {
      return {
        ok: false,
        error: parseBridgeErrorPayload(responsePayload[1])
      };
    }

    return {
      ok: true,
      result: responsePayload
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    try {
      if (port && typeof port.close === "function") {
        port.close();
      }
    } catch (_error) {
      // Ignore cleanup failures.
    }

    try {
      iframe?.remove();
    } catch (_error) {
      // Ignore cleanup failures.
    }
  }

  function loadBridgeFrame(frameUrl, frameTimeoutMs) {
    return new Promise((resolve, reject) => {
      const frame = document.createElement("iframe");
      frame.hidden = true;
      frame.src = frameUrl;

      const onLoad = () => {
        cleanup();
        resolve(frame);
      };
      const onError = () => {
        cleanup();
        reject(new Error("Unable to load Zotero connector bridge iframe."));
      };
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out while loading Zotero connector bridge iframe."));
      }, frameTimeoutMs);

      const cleanup = () => {
        clearTimeout(timeoutId);
        frame.removeEventListener("load", onLoad);
        frame.removeEventListener("error", onError);
      };

      frame.addEventListener("load", onLoad, { once: true });
      frame.addEventListener("error", onError, { once: true });
      (document.body || document.documentElement || document).append(frame);
    });
  }

  function initializeBridgePort(frame, portTimeoutMs) {
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out while opening connector bridge channel."));
      }, portTimeoutMs);

      const cleanup = () => {
        clearTimeout(timeoutId);
        channel.port1.onmessage = null;
      };

      channel.port1.onmessage = () => {
        cleanup();
        resolve(channel.port1);
      };

      try {
        frame.contentWindow.postMessage("zoteroChannel", "*", [channel.port2]);
      } catch (error) {
        cleanup();
        reject(new Error(`Failed to initialize connector bridge channel: ${String(error)}`));
      }
    });
  }

  function sendBridgeMessage(activePort, message, payload, messageTimeoutMs) {
    return new Promise((resolve, reject) => {
      const messageId = `archivist-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for connector bridge response."));
      }, messageTimeoutMs);

      const cleanup = () => {
        clearTimeout(timeoutId);
        activePort.onmessage = null;
      };

      activePort.onmessage = (event) => {
        const data = event?.data;
        if (!Array.isArray(data) || data.length < 3) {
          return;
        }

        const [, responsePayload, responseId] = data;
        if (responseId !== messageId) {
          return;
        }

        cleanup();
        resolve(responsePayload);
      };

      try {
        activePort.postMessage([message, payload, messageId]);
      } catch (error) {
        cleanup();
        reject(new Error(`Failed to post connector bridge message: ${String(error)}`));
      }
    });
  }

  function parseBridgeErrorPayload(rawPayload) {
    if (typeof rawPayload === "string" && rawPayload.trim().length > 0) {
      try {
        const parsed = JSON.parse(rawPayload);
        if (parsed && typeof parsed.message === "string" && parsed.message.trim().length > 0) {
          return parsed.message.trim();
        }
      } catch (_error) {
        return rawPayload.trim();
      }

      return rawPayload.trim();
    }

    return "Connector bridge command returned an error response.";
  }
}
