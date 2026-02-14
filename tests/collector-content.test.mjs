import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

const collectorScriptSource = fs.readFileSync(
  new URL("../content/collector.js", import.meta.url),
  "utf8"
);

test("collector auto-scrolls and captures links loaded later", async () => {
  const harness = createCollectorHarness({ growthRounds: 2 });

  const { response, returned } = await runCollector(harness.listener, {
    rules: [
      {
        id: "anchors",
        cssSelector: "a[href]",
        urlAttribute: "href",
        enabled: true
      }
    ],
    maxLinks: 50,
    autoScrollEnabled: true,
    autoScrollMaxRounds: 10,
    autoScrollIdleRounds: 2,
    autoScrollSettleDelayMs: 1
  });

  assert.equal(returned, true);
  assert.equal(response.ok, true);
  assert.deepEqual(
    Array.from(response.links, (link) => link.url),
    [
      "https://example.com/post-1",
      "https://example.com/post-2",
      "https://example.com/post-3"
    ]
  );
  assert.ok(harness.state.scrollCalls.length > 0);
  assert.equal(harness.scrollingElement.scrollTop, harness.initialScrollTop);
});

test("collector can skip auto-scroll when disabled", async () => {
  const harness = createCollectorHarness({ growthRounds: 2 });

  const { response, returned } = await runCollector(harness.listener, {
    rules: [
      {
        id: "anchors",
        cssSelector: "a[href]",
        urlAttribute: "href",
        enabled: true
      }
    ],
    maxLinks: 50,
    autoScrollEnabled: false
  });

  assert.equal(returned, true);
  assert.equal(response.ok, true);
  assert.equal(response.links.length, 1);
  assert.equal(response.links[0].url, "https://example.com/post-1");
  assert.equal(harness.state.scrollCalls.length, 0);
  assert.equal(harness.scrollingElement.scrollTop, harness.initialScrollTop);
});

function createCollectorHarness({ growthRounds = 0, initialScrollTop = 120 } = {}) {
  const listeners = [];
  const state = {
    round: 0,
    scrollCalls: []
  };

  const scrollingElement = {
    scrollTop: initialScrollTop,
    clientHeight: 800,
    scrollHeight: 1800
  };
  const documentElement = {
    scrollHeight: scrollingElement.scrollHeight
  };
  const body = {
    scrollHeight: scrollingElement.scrollHeight
  };

  const linkSetsByRound = [
    [
      createLinkElement({
        href: "https://example.com/post-1",
        title: "Post 1"
      })
    ],
    [
      createLinkElement({
        href: "https://example.com/post-1",
        title: "Post 1"
      }),
      createLinkElement({
        href: "https://example.com/post-2",
        title: "Post 2"
      })
    ],
    [
      createLinkElement({
        href: "https://example.com/post-1",
        title: "Post 1"
      }),
      createLinkElement({
        href: "https://example.com/post-2",
        title: "Post 2"
      }),
      createLinkElement({
        href: "https://example.com/post-3",
        title: "Post 3"
      })
    ]
  ];

  const document = {
    baseURI: "https://example.com/",
    scrollingElement,
    documentElement,
    body,
    querySelectorAll(selector) {
      if (selector !== "a[href]") {
        return [];
      }

      const roundIndex = Math.min(state.round, linkSetsByRound.length - 1);
      return linkSetsByRound[roundIndex];
    }
  };

  const window = {
    innerHeight: scrollingElement.clientHeight,
    scrollTo(_x, y) {
      const top = Number.isFinite(y) ? Math.max(0, Math.trunc(y)) : 0;
      state.scrollCalls.push(top);
      scrollingElement.scrollTop = top;

      const bottomThreshold = Math.max(0, scrollingElement.scrollHeight - scrollingElement.clientHeight);
      if (top >= bottomThreshold && state.round < growthRounds) {
        state.round += 1;
        scrollingElement.scrollHeight += 700;
        documentElement.scrollHeight = scrollingElement.scrollHeight;
        body.scrollHeight = scrollingElement.scrollHeight;
      }
    }
  };
  Object.defineProperty(window, "scrollY", {
    get() {
      return scrollingElement.scrollTop;
    }
  });

  const chrome = {
    runtime: {
      onMessage: {
        addListener(listener) {
          listeners.push(listener);
        }
      }
    }
  };

  const context = vm.createContext({
    chrome,
    document,
    window,
    URL,
    RegExp,
    Set,
    Number,
    Math,
    Promise,
    String,
    Boolean,
    setTimeout,
    clearTimeout,
    console
  });
  context.globalThis = context;

  vm.runInContext(collectorScriptSource, context, {
    filename: "content/collector.js"
  });

  return {
    listener: listeners[0],
    state,
    scrollingElement,
    initialScrollTop
  };
}

function createLinkElement({ href, title }) {
  return {
    href,
    textContent: title,
    getAttribute(name) {
      if (name === "href") {
        return href;
      }
      if (name === "title") {
        return title;
      }
      return null;
    }
  };
}

async function runCollector(listener, payload) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Collector response timed out."));
    }, 2500);

    let returnedValue = false;
    try {
      returnedValue = listener(
        {
          type: "RUN_COLLECTOR",
          payload
        },
        null,
        (response) => {
          clearTimeout(timeout);
          resolve({
            returned: returnedValue,
            response
          });
        }
      );
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
  });
}
