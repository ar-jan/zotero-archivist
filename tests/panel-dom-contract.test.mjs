import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function extractMatches(sourceText, pattern) {
  const matches = [];
  let match = pattern.exec(sourceText);
  while (match !== null) {
    matches.push(match[1]);
    match = pattern.exec(sourceText);
  }
  pattern.lastIndex = 0;
  return matches;
}

test("panel.html includes every id used by panel.js getElementById lookups", () => {
  const panelScript = readFileSync(new URL("../sidepanel/panel.js", import.meta.url), "utf8");
  const panelMarkup = readFileSync(new URL("../sidepanel/panel.html", import.meta.url), "utf8");

  const jsIds = new Set(extractMatches(panelScript, /getElementById\("([^"]+)"\)/g));
  const htmlIds = new Set(extractMatches(panelMarkup, /id="([^"]+)"/g));
  const missingIds = [...jsIds].filter((id) => !htmlIds.has(id));

  assert.deepEqual(
    missingIds,
    [],
    `panel.js has unresolved DOM IDs in panel.html: ${missingIds.join(", ")}`
  );
});

test("selector and results sections keep toggle markup contract", () => {
  const panelMarkup = readFileSync(new URL("../sidepanel/panel.html", import.meta.url), "utf8");

  assert.match(
    panelMarkup,
    /id="selectors-toggle-button"[\s\S]*aria-controls="selectors-body"/,
    "selectors toggle button should control selectors-body"
  );
  assert.match(
    panelMarkup,
    /id="results-toggle-button"[\s\S]*aria-controls="results-body"/,
    "results toggle button should control results-body"
  );
});

test("panel.html does not contain duplicate ids", () => {
  const panelMarkup = readFileSync(new URL("../sidepanel/panel.html", import.meta.url), "utf8");
  const ids = extractMatches(panelMarkup, /id="([^"]+)"/g);
  const uniqueIds = new Set();
  const duplicateIds = [];

  for (const id of ids) {
    if (uniqueIds.has(id)) {
      duplicateIds.push(id);
      continue;
    }
    uniqueIds.add(id);
  }

  assert.deepEqual(
    duplicateIds,
    [],
    `panel.html has duplicate ids: ${duplicateIds.join(", ")}`
  );
});
