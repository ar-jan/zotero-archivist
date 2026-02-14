import { createConnectorBridgeProvider } from "../zotero/provider-connector-bridge.js";

export function createProviderOrchestrator({
  saveProviderDiagnostics,
  createConnectorBridgeProviderImpl = createConnectorBridgeProvider
}) {
  async function saveQueueItemWithProvider({ queueItem, tabId }) {
    const { provider, diagnostics, unavailableReason } = await resolveSaveProvider({ tabId });
    if (!provider || typeof provider.saveWebPageWithSnapshot !== "function") {
      const unavailableMessage = formatConnectorBridgeUnavailableMessage(
        diagnostics.connectorBridge,
        unavailableReason
      );
      await saveProviderDiagnostics({
        ...diagnostics,
        lastError: unavailableMessage,
        updatedAt: Date.now()
      });
      return {
        ok: false,
        error: unavailableMessage
      };
    }

    let providerResult;
    try {
      providerResult = await provider.saveWebPageWithSnapshot({
        tabId,
        url: queueItem.url,
        title: queueItem.title
      });
    } catch (error) {
      const thrownMessage = `Provider ${provider.mode} threw: ${String(error)}`;
      await saveProviderDiagnostics({
        ...diagnostics,
        lastError: thrownMessage,
        updatedAt: Date.now()
      });
      return {
        ok: false,
        error: thrownMessage
      };
    }

    if (providerResult?.ok === true) {
      await saveProviderDiagnostics({
        ...diagnostics,
        updatedAt: Date.now()
      });
      return {
        ok: true
      };
    }

    const providerError =
      typeof providerResult?.error === "string" && providerResult.error.length > 0
        ? providerResult.error
        : `Provider ${provider.mode} failed to save the page.`;
    await saveProviderDiagnostics({
      ...diagnostics,
      lastError: providerError,
      updatedAt: Date.now()
    });
    return {
      ok: false,
      error: providerError
    };
  }

  async function resolveSaveProvider({ tabId = null } = {}) {
    let activeProvider = null;
    let connectorHealth = null;
    let connectorHealthMessage = null;

    const connectorBridgeProvider = createConnectorBridgeProviderImpl();
    try {
      connectorHealth = await connectorBridgeProvider.checkHealth({ tabId });
    } catch (error) {
      connectorHealth = {
        ok: false,
        message: `Connector bridge health check failed: ${String(error)}`,
        connectorAvailable: null,
        zoteroOnline: null
      };
    }

    connectorHealthMessage = normalizeConnectorHealthMessage(
      connectorHealth?.message,
      "Connector bridge health check returned no status message."
    );

    if (connectorHealth.ok === true) {
      activeProvider = connectorBridgeProvider;
    }

    const diagnostics = {
      activeMode: activeProvider?.mode ?? "connector_bridge",
      connectorBridge: {
        enabled: true,
        healthy: connectorHealth?.ok === true,
        connectorAvailable:
          connectorHealth?.connectorAvailable === true
            ? true
            : connectorHealth?.connectorAvailable === false
              ? false
              : null,
        zoteroOnline:
          connectorHealth?.zoteroOnline === true
            ? true
            : connectorHealth?.zoteroOnline === false
              ? false
              : null
      },
      lastError: null,
      updatedAt: Date.now()
    };

    await saveProviderDiagnostics(diagnostics);

    return {
      provider: activeProvider,
      diagnostics,
      unavailableReason: connectorHealthMessage
    };
  }

  async function refreshProviderDiagnostics() {
    const { diagnostics } = await resolveSaveProvider();
    return diagnostics;
  }

  return {
    refreshProviderDiagnostics,
    resolveSaveProvider,
    saveQueueItemWithProvider
  };
}

function normalizeConnectorHealthMessage(message, fallback) {
  if (typeof message === "string" && message.trim().length > 0) {
    return message.trim();
  }

  return fallback;
}

function formatConnectorBridgeUnavailableMessage(connectorBridge, reason) {
  const normalizedReason = normalizeConnectorHealthMessage(reason, "");
  if (normalizedReason.length > 0) {
    return `Connector bridge is unavailable. ${normalizedReason}`;
  }

  if (connectorBridge.connectorAvailable === false) {
    return "Connector bridge is unavailable. Zotero Connector extension is unavailable.";
  }

  if (connectorBridge.zoteroOnline === false) {
    return "Connector bridge is unavailable. Zotero app appears to be offline.";
  }

  return "Connector bridge is unavailable.";
}
