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
const CONNECTOR_OFFLINE_MESSAGE =
  "Zotero Connector reports the local Zotero client as offline for bridge save.";

export function createConnectorBridgeProvider() {
  return {
    mode: SAVE_PROVIDER_MODES.CONNECTOR_BRIDGE,
    async checkHealth(input = {}) {
      if (!Number.isInteger(input?.tabId)) {
        return {
          ok: false,
          details: "Connector bridge probe requires an active queue tab."
        };
      }

      const probeResult = await runBridgeCommand({
        tabId: input.tabId,
        timeoutMs: BRIDGE_HEALTH_TIMEOUT_MS,
        command: ["Connector.checkIsOnline", []]
      });
      if (!probeResult.ok) {
        return {
          ok: false,
          details: `Connector bridge probe failed: ${probeResult.error}`
        };
      }

      if (probeResult.result !== true) {
        return {
          ok: false,
          details: CONNECTOR_OFFLINE_MESSAGE
        };
      }

      return {
        ok: true,
        details: "Connector bridge channel is reachable and Zotero client is online."
      };
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
        return createProviderSaveError(CONNECTOR_OFFLINE_MESSAGE);
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
