import { SAVE_PROVIDER_MODES } from "../shared/protocol.js";
import {
  createProviderSaveError
} from "./provider-interface.js";

const CONNECTOR_BRIDGE_UNAVAILABLE_MESSAGE =
  "Connector bridge is enabled, but no stable bridge implementation is available in this build.";

export function createConnectorBridgeProvider() {
  return {
    mode: SAVE_PROVIDER_MODES.CONNECTOR_BRIDGE,
    async checkHealth() {
      return {
        ok: false,
        details: CONNECTOR_BRIDGE_UNAVAILABLE_MESSAGE
      };
    },
    async saveWebPageWithSnapshot(_input) {
      return createProviderSaveError(CONNECTOR_BRIDGE_UNAVAILABLE_MESSAGE);
    }
  };
}
