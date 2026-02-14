export function installBridgeChromeMock({
  executeScriptResponder = async () => ({ ok: true, result: true }),
  permissionsContains = async () => false,
  queryTabs = async () => [],
  tabsById = new Map()
} = {}) {
  const previousChrome = globalThis.chrome;

  const state = {
    calls: {
      contains: [],
      executeScript: [],
      tabsGet: [],
      tabsQuery: []
    }
  };

  globalThis.chrome = {
    permissions: {
      async contains(details) {
        state.calls.contains.push(details);
        return permissionsContains(details);
      }
    },
    scripting: {
      async executeScript({ target, func, args }) {
        const bridgeArgs = Array.isArray(args) ? args[0] : undefined;
        const workerCommand = Array.isArray(bridgeArgs?.workerCommand) ? bridgeArgs.workerCommand : null;
        const commandName = typeof workerCommand?.[0] === "string" ? workerCommand[0] : null;
        const commandArgs = Array.isArray(workerCommand?.[1]) ? workerCommand[1] : null;

        const call = {
          args,
          commandArgs,
          commandName,
          func,
          tabId: target?.tabId
        };
        state.calls.executeScript.push(call);

        const result = await executeScriptResponder(call);
        if (result instanceof Error) {
          throw result;
        }
        return [{ result }];
      }
    },
    tabs: {
      async get(tabId) {
        state.calls.tabsGet.push(tabId);
        if (!tabsById.has(tabId)) {
          throw new Error(`Tab ${tabId} not found.`);
        }
        return { ...tabsById.get(tabId) };
      },
      async query(queryInfo) {
        state.calls.tabsQuery.push(queryInfo);
        const tabs = await queryTabs(queryInfo);
        return Array.isArray(tabs) ? tabs.map((tab) => ({ ...tab })) : [];
      }
    }
  };

  return {
    calls: state.calls,
    restore() {
      if (previousChrome === undefined) {
        delete globalThis.chrome;
        return;
      }
      globalThis.chrome = previousChrome;
    }
  };
}
