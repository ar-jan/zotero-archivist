import { SAVE_PROVIDER_MODES } from "../shared/protocol.js";
import {
  createProviderSaveError
} from "./provider-interface.js";

const LOCAL_API_UNAVAILABLE_MESSAGE = "Local API provider is not implemented yet.";

export function createLocalApiProvider() {
  return {
    mode: SAVE_PROVIDER_MODES.LOCAL_API,
    async checkHealth() {
      return {
        ok: false,
        details: LOCAL_API_UNAVAILABLE_MESSAGE
      };
    },
    async saveWebPageWithSnapshot(_input) {
      return createProviderSaveError(LOCAL_API_UNAVAILABLE_MESSAGE);
    }
  };
}
