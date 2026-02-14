import { DEFAULT_PROVIDER_SETTINGS, SAVE_PROVIDER_MODES } from "../shared/protocol.js";

export function normalizeProviderSettings(input) {
  return {
    connectorBridgeEnabled: DEFAULT_PROVIDER_SETTINGS.connectorBridgeEnabled
  };
}

export function createDefaultProviderDiagnostics() {
  return {
    activeMode: SAVE_PROVIDER_MODES.CONNECTOR_BRIDGE,
    connectorBridge: {
      enabled: DEFAULT_PROVIDER_SETTINGS.connectorBridgeEnabled,
      healthy: false,
      connectorAvailable: null,
      zoteroOnline: null
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
    (input.activeMode === SAVE_PROVIDER_MODES.CONNECTOR_BRIDGE ||
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

export function createProviderSaveError(error) {
  return {
    ok: false,
    error
  };
}

function normalizeConnectorBridgeDiagnostics(input) {
  const defaultEnabled = DEFAULT_PROVIDER_SETTINGS.connectorBridgeEnabled;
  if (!input || typeof input !== "object") {
    return {
      enabled: defaultEnabled,
      healthy: false,
      connectorAvailable: null,
      zoteroOnline: null
    };
  }

  const enabled = typeof input.enabled === "boolean" ? input.enabled : defaultEnabled;
  return {
    enabled,
    healthy: input.healthy === true,
    connectorAvailable: normalizeNullableBoolean(input.connectorAvailable),
    zoteroOnline: normalizeNullableBoolean(input.zoteroOnline)
  };
}

function normalizeNullableBoolean(value) {
  if (value === true) {
    return true;
  }
  if (value === false) {
    return false;
  }
  return null;
}
