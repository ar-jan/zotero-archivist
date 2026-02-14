import { DEFAULT_PROVIDER_SETTINGS, SAVE_PROVIDER_MODES } from "../shared/protocol.js";

export function normalizeProviderSettings(input) {
  if (!input || typeof input !== "object") {
    return { ...DEFAULT_PROVIDER_SETTINGS };
  }

  return {
    connectorBridgeEnabled: input.connectorBridgeEnabled === true
  };
}

export function createDefaultProviderDiagnostics() {
  return {
    activeMode: SAVE_PROVIDER_MODES.MANUAL,
    connectorBridge: {
      enabled: false,
      healthy: false,
      details: "Connector bridge is disabled."
    },
    lastError: null,
    updatedAt: Date.now()
  };
}

export function normalizeProviderDiagnostics(input) {
  const defaults = createDefaultProviderDiagnostics();
  if (!input || typeof input !== "object") {
    return defaults;
  }

  const activeMode =
    typeof input.activeMode === "string" &&
    (input.activeMode === SAVE_PROVIDER_MODES.MANUAL ||
      input.activeMode === SAVE_PROVIDER_MODES.CONNECTOR_BRIDGE ||
      input.activeMode === SAVE_PROVIDER_MODES.LOCAL_API)
      ? input.activeMode
      : defaults.activeMode;

  const connectorBridge = normalizeConnectorBridgeDiagnostics(input.connectorBridge);
  const lastError =
    typeof input.lastError === "string" && input.lastError.trim().length > 0
      ? input.lastError.trim()
      : null;
  const updatedAt =
    Number.isFinite(input.updatedAt) && input.updatedAt > 0
      ? Math.trunc(input.updatedAt)
      : Date.now();

  return {
    activeMode,
    connectorBridge,
    lastError,
    updatedAt
  };
}

export function createProviderSaveSuccess() {
  return {
    ok: true
  };
}

export function createProviderSaveManual(details) {
  return {
    ok: false,
    requiresManual: true,
    details
  };
}

export function createProviderSaveError(error) {
  return {
    ok: false,
    error
  };
}

function normalizeConnectorBridgeDiagnostics(input) {
  if (!input || typeof input !== "object") {
    return {
      enabled: false,
      healthy: false,
      details: "Connector bridge is disabled."
    };
  }

  return {
    enabled: input.enabled === true,
    healthy: input.healthy === true,
    details:
      typeof input.details === "string" && input.details.trim().length > 0
        ? input.details.trim()
        : input.enabled === true
          ? "Connector bridge status unknown."
          : "Connector bridge is disabled."
  };
}
