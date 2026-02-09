(() => {
  if (globalThis.__zoteroArchivistCollectorInstalled) {
    return;
  }
  globalThis.__zoteroArchivistCollectorInstalled = true;

  const RUN_COLLECTOR = "RUN_COLLECTOR";
  const MAX_LINKS = 500;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== RUN_COLLECTOR) {
      return false;
    }

    try {
      const rules = Array.isArray(message.payload?.rules) ? message.payload.rules : [];
      const links = collectLinks(rules);
      sendResponse({ ok: true, links });
    } catch (error) {
      sendResponse({
        ok: false,
        error: {
          message: error instanceof Error ? error.message : String(error)
        }
      });
    }

    return false;
  });

  function collectLinks(rules) {
    const enabledRules = Array.isArray(rules)
      ? rules.filter((rule) => rule && rule.enabled !== false && typeof rule.cssSelector === "string")
      : [];

    const dedupe = new Set();
    const collected = [];

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
        if (collected.length >= MAX_LINKS) {
          return collected;
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
      }
    }

    return collected;
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
