(() => {
  if (globalThis.__zoteroArchivistCollectorInstalled) {
    return;
  }
  globalThis.__zoteroArchivistCollectorInstalled = true;

  const RUN_COLLECTOR = "RUN_COLLECTOR";
  const DEFAULT_MAX_LINKS = 500;
  const MIN_MAX_LINKS = 1;
  const MAX_MAX_LINKS = 5000;
  const DEFAULT_AUTO_SCROLL_ENABLED = true;
  const DEFAULT_AUTO_SCROLL_MAX_ROUNDS = 30;
  const MIN_AUTO_SCROLL_MAX_ROUNDS = 1;
  const MAX_AUTO_SCROLL_MAX_ROUNDS = 200;
  const DEFAULT_AUTO_SCROLL_IDLE_ROUNDS = 3;
  const MIN_AUTO_SCROLL_IDLE_ROUNDS = 1;
  const MAX_AUTO_SCROLL_IDLE_ROUNDS = 20;
  const DEFAULT_AUTO_SCROLL_SETTLE_DELAY_MS = 750;
  const MIN_AUTO_SCROLL_SETTLE_DELAY_MS = 100;
  const MAX_AUTO_SCROLL_SETTLE_DELAY_MS = 10000;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== RUN_COLLECTOR) {
      return false;
    }

    void handleCollectorMessage(message.payload)
      .then((links) => {
        sendResponse({ ok: true, links });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: {
            message: error instanceof Error ? error.message : String(error)
          }
        });
      });

    return true;
  });

  async function handleCollectorMessage(payload) {
    const rules = Array.isArray(payload?.rules) ? payload.rules : [];
    const settings = normalizeCollectorRunSettings(payload);
    return collectLinks(rules, settings);
  }

  async function collectLinks(rules, settings) {
    const enabledRules = Array.isArray(rules)
      ? rules.filter((rule) => rule && rule.enabled !== false && typeof rule.cssSelector === "string")
      : [];

    const dedupe = new Set();
    const collected = [];
    const maxLinks = settings.maxLinks;

    collectLinksFromDom(enabledRules, maxLinks, dedupe, collected);

    if (
      settings.autoScrollEnabled &&
      enabledRules.length > 0 &&
      collected.length < maxLinks
    ) {
      try {
        await autoScrollAndCollect(enabledRules, settings, dedupe, collected);
      } catch (_error) {
      }
    }

    return collected;
  }

  function collectLinksFromDom(enabledRules, maxLinks, dedupe, collected) {
    let addedCount = 0;
    for (const rule of enabledRules) {
      const selectorId = typeof rule.id === "string" && rule.id.length > 0 ? rule.id : "unknown";
      const urlAttribute =
        typeof rule.urlAttribute === "string" && rule.urlAttribute.length > 0
          ? rule.urlAttribute
          : "href";

      let elements;
      try {
        elements = document.querySelectorAll(rule.cssSelector);
      } catch (_error) {
        continue;
      }

      for (const element of elements) {
        if (collected.length >= maxLinks) {
          return addedCount;
        }

        const rawUrl = getRawUrl(element, urlAttribute);
        if (!rawUrl) {
          continue;
        }

        const normalizedUrl = toHttpUrl(rawUrl);
        if (!normalizedUrl) {
          continue;
        }

        if (!matchesIncludePattern(normalizedUrl, rule.includePattern)) {
          continue;
        }
        if (matchesExcludePattern(normalizedUrl, rule.excludePattern)) {
          continue;
        }

        const dedupeKey = normalizedUrl.toLowerCase();
        if (dedupe.has(dedupeKey)) {
          continue;
        }
        dedupe.add(dedupeKey);

        const title = getTitle(element, normalizedUrl);
        collected.push({
          id: `${selectorId}-${collected.length + 1}`,
          url: normalizedUrl,
          title,
          sourceSelectorId: selectorId,
          selected: true,
          dedupeKey
        });
        addedCount += 1;
      }
    }

    return addedCount;
  }

  async function autoScrollAndCollect(enabledRules, settings, dedupe, collected) {
    const scrollContainer = getScrollContainer();
    if (!scrollContainer) {
      return;
    }

    const initialScrollTop = getScrollTop(scrollContainer);
    let idleRounds = 0;

    try {
      for (let round = 0; round < settings.autoScrollMaxRounds; round += 1) {
        if (collected.length >= settings.maxLinks) {
          return;
        }

        const previousHeight = getScrollHeight(scrollContainer);
        const previousCollectedCount = collected.length;

        scrollToPosition(scrollContainer, previousHeight);
        await wait(settings.autoScrollSettleDelayMs);

        const currentHeight = getScrollHeight(scrollContainer);
        const addedCount = collectLinksFromDom(enabledRules, settings.maxLinks, dedupe, collected);
        const hasNewLinks = collected.length > previousCollectedCount || addedCount > 0;
        const hasPageGrowth = currentHeight > previousHeight;

        if (hasNewLinks || hasPageGrowth) {
          idleRounds = 0;
          continue;
        }

        idleRounds += 1;
        if (idleRounds >= settings.autoScrollIdleRounds) {
          return;
        }
      }
    } finally {
      scrollToPosition(scrollContainer, initialScrollTop);
    }
  }

  function getScrollContainer() {
    if (document.scrollingElement) {
      return document.scrollingElement;
    }
    if (document.documentElement) {
      return document.documentElement;
    }
    if (document.body) {
      return document.body;
    }
    return null;
  }

  function getScrollHeight(scrollContainer) {
    if (!scrollContainer) {
      return 0;
    }

    if (isRootScrollContainer(scrollContainer)) {
      const rootHeight = Number.isFinite(scrollContainer.scrollHeight)
        ? scrollContainer.scrollHeight
        : 0;
      const documentElementHeight = Number.isFinite(document.documentElement?.scrollHeight)
        ? document.documentElement.scrollHeight
        : 0;
      const bodyHeight = Number.isFinite(document.body?.scrollHeight) ? document.body.scrollHeight : 0;
      return Math.max(rootHeight, documentElementHeight, bodyHeight);
    }

    return Number.isFinite(scrollContainer.scrollHeight) ? scrollContainer.scrollHeight : 0;
  }

  function getScrollTop(scrollContainer) {
    if (!scrollContainer) {
      return 0;
    }

    if (isRootScrollContainer(scrollContainer) && Number.isFinite(window.scrollY)) {
      return window.scrollY;
    }

    return Number.isFinite(scrollContainer.scrollTop) ? scrollContainer.scrollTop : 0;
  }

  function scrollToPosition(scrollContainer, top) {
    if (!scrollContainer) {
      return;
    }

    const normalizedTop = Number.isFinite(top) ? Math.max(0, Math.trunc(top)) : 0;
    if (isRootScrollContainer(scrollContainer)) {
      window.scrollTo(0, normalizedTop);
      return;
    }

    scrollContainer.scrollTop = normalizedTop;
  }

  function wait(delayMs) {
    return new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }

  function isRootScrollContainer(scrollContainer) {
    return (
      scrollContainer === document.scrollingElement ||
      scrollContainer === document.documentElement ||
      scrollContainer === document.body
    );
  }

  function normalizeCollectorRunSettings(payload) {
    return {
      maxLinks: normalizeMaxLinks(payload?.maxLinks),
      autoScrollEnabled: normalizeAutoScrollEnabled(payload?.autoScrollEnabled),
      autoScrollMaxRounds: normalizeAutoScrollMaxRounds(payload?.autoScrollMaxRounds),
      autoScrollIdleRounds: normalizeAutoScrollIdleRounds(payload?.autoScrollIdleRounds),
      autoScrollSettleDelayMs: normalizeAutoScrollSettleDelayMs(payload?.autoScrollSettleDelayMs)
    };
  }

  function normalizeMaxLinks(value) {
    if (!Number.isFinite(value)) {
      return DEFAULT_MAX_LINKS;
    }

    const normalized = Math.trunc(value);
    if (normalized < MIN_MAX_LINKS) {
      return MIN_MAX_LINKS;
    }
    if (normalized > MAX_MAX_LINKS) {
      return MAX_MAX_LINKS;
    }
    return normalized;
  }

  function normalizeAutoScrollEnabled(value) {
    if (value === true) {
      return true;
    }
    if (value === false) {
      return false;
    }
    return DEFAULT_AUTO_SCROLL_ENABLED;
  }

  function normalizeAutoScrollMaxRounds(value) {
    return normalizeInteger(
      value,
      DEFAULT_AUTO_SCROLL_MAX_ROUNDS,
      MIN_AUTO_SCROLL_MAX_ROUNDS,
      MAX_AUTO_SCROLL_MAX_ROUNDS
    );
  }

  function normalizeAutoScrollIdleRounds(value) {
    return normalizeInteger(
      value,
      DEFAULT_AUTO_SCROLL_IDLE_ROUNDS,
      MIN_AUTO_SCROLL_IDLE_ROUNDS,
      MAX_AUTO_SCROLL_IDLE_ROUNDS
    );
  }

  function normalizeAutoScrollSettleDelayMs(value) {
    return normalizeInteger(
      value,
      DEFAULT_AUTO_SCROLL_SETTLE_DELAY_MS,
      MIN_AUTO_SCROLL_SETTLE_DELAY_MS,
      MAX_AUTO_SCROLL_SETTLE_DELAY_MS
    );
  }

  function normalizeInteger(value, fallback, min, max) {
    if (!Number.isFinite(value)) {
      return fallback;
    }

    const normalized = Math.trunc(value);
    if (normalized < min) {
      return min;
    }
    if (normalized > max) {
      return max;
    }
    return normalized;
  }

  function getRawUrl(element, urlAttribute) {
    if (!element || typeof element.getAttribute !== "function") {
      return null;
    }

    if (urlAttribute === "href" && typeof element.href === "string" && element.href.length > 0) {
      return element.href;
    }

    const attributeValue = element.getAttribute(urlAttribute);
    if (typeof attributeValue === "string" && attributeValue.trim().length > 0) {
      return attributeValue.trim();
    }

    return null;
  }

  function toHttpUrl(value) {
    if (typeof value !== "string" || value.length === 0) {
      return null;
    }

    let parsed;
    try {
      parsed = new URL(value, document.baseURI);
    } catch (_error) {
      return null;
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    return parsed.toString();
  }

  function getTitle(element, fallback) {
    const titleAttribute =
      typeof element.getAttribute === "function" ? element.getAttribute("title") : null;
    if (typeof titleAttribute === "string" && titleAttribute.trim().length > 0) {
      return titleAttribute.trim();
    }

    const text = typeof element.textContent === "string" ? normalizeWhitespace(element.textContent) : "";
    if (text.length > 0) {
      return text;
    }

    return fallback;
  }

  function normalizeWhitespace(value) {
    return value.replace(/\s+/g, " ").trim();
  }

  function matchesIncludePattern(url, includePattern) {
    if (typeof includePattern !== "string" || includePattern.trim().length === 0) {
      return true;
    }
    return testPattern(url, includePattern);
  }

  function matchesExcludePattern(url, excludePattern) {
    if (typeof excludePattern !== "string" || excludePattern.trim().length === 0) {
      return false;
    }
    return testPattern(url, excludePattern);
  }

  function testPattern(value, pattern) {
    const trimmedPattern = pattern.trim();
    try {
      return new RegExp(trimmedPattern, "i").test(value);
    } catch (_error) {
      return value.includes(trimmedPattern);
    }
  }
})();
