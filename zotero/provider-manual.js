import { SAVE_PROVIDER_MODES } from "../shared/protocol.js";
import {
  createProviderSaveManual
} from "./provider-interface.js";

const MANUAL_PROVIDER_DETAILS =
  "Use the Zotero Connector save action on the opened tab, then mark the queue item as saved or failed.";

export function createManualProvider() {
  return {
    mode: SAVE_PROVIDER_MODES.MANUAL,
    async checkHealth() {
      return {
        ok: true,
        details: "Manual provider is ready."
      };
    },
    async saveWebPageWithSnapshot(input) {
      if (Number.isInteger(input?.tabId)) {
        try {
          await chrome.tabs.update(input.tabId, { active: true });
        } catch (_error) {
          // Queue still transitions to manual_required even when activation fails.
        }
      }

      return createProviderSaveManual(MANUAL_PROVIDER_DETAILS);
    }
  };
}
