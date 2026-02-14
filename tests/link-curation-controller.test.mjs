import test from "node:test";
import assert from "node:assert/strict";

import {
  createLinkCurationController,
  invertFilteredLinkSelectionState,
  updateFilteredLinkSelection,
  updateSingleLinkSelection
} from "../sidepanel/link-curation-controller.js";

test("single-link selection updates only the target link", () => {
  const links = [
    { id: "l1", selected: false },
    { id: "l2", selected: true }
  ];

  const result = updateSingleLinkSelection(links, "l1", true);

  assert.equal(result.changedCount, 1);
  assert.equal(result.nextLinks[0].selected, true);
  assert.equal(result.nextLinks[1].selected, true);
});

test("filtered selection updates only filtered links", () => {
  const links = [
    { id: "l1", selected: false },
    { id: "l2", selected: false },
    { id: "l3", selected: true }
  ];

  const result = updateFilteredLinkSelection(links, [{ id: "l1" }, { id: "l3" }], true);

  assert.equal(result.changedCount, 1);
  assert.equal(result.nextLinks[0].selected, true);
  assert.equal(result.nextLinks[1].selected, false);
  assert.equal(result.nextLinks[2].selected, true);
});

test("invert filtered selection flips only filtered links", () => {
  const links = [
    { id: "l1", selected: false },
    { id: "l2", selected: true }
  ];

  const result = invertFilteredLinkSelectionState(links, [{ id: "l1" }]);

  assert.equal(result.changedCount, 1);
  assert.equal(result.nextLinks[0].selected, true);
  assert.equal(result.nextLinks[1].selected, true);
});

test("controller reports no filtered links when filter is empty result", async () => {
  const harness = createHarness({
    filterQuery: "missing",
    getFilteredLinksImpl: () => []
  });

  await harness.controller.setFilteredLinksSelectedState(true);

  assert.equal(harness.statuses.at(-1), "No links match the current filter.");
  assert.equal(harness.persistedSnapshots.length, 0);
});

test("controller persists filtered selection changes", async () => {
  const harness = createHarness({
    initialLinks: [
      { id: "l1", url: "https://example.com/one", selected: false },
      { id: "l2", url: "https://example.com/two", selected: false }
    ],
    filterQuery: "one"
  });

  await harness.controller.setFilteredLinksSelectedState(true);

  assert.equal(harness.statuses.at(-1), "Selected 1 filtered link(s).");
  assert.equal(harness.persistedSnapshots.length, 1);
  assert.equal(harness.currentLinks[0].selected, true);
  assert.equal(harness.currentLinks[1].selected, false);
});

test("controller surfaces persistence errors", async () => {
  const harness = createHarness({
    setCollectedLinksActionImpl: async () => ({
      ok: false,
      error: { message: "storage write failed" }
    })
  });

  await harness.controller.clearCollectedLinks();

  assert.equal(harness.statuses.at(-1), "storage write failed");
});

test("controller handles result checkbox changes", async () => {
  const harness = createHarness({
    initialLinks: [{ id: "l1", url: "https://example.com/one", selected: true }]
  });

  await harness.controller.handleResultsListChange({
    target: {
      checked: false,
      dataset: { linkId: "l1" },
      classList: {
        contains(className) {
          return className === "result-selected-input";
        }
      }
    }
  });

  assert.equal(harness.statuses.at(-1), "Cleared 1 link.");
  assert.equal(harness.currentLinks[0].selected, false);
});

function createHarness({
  initialLinks = [
    { id: "l1", url: "https://example.com/one", selected: true },
    { id: "l2", url: "https://example.com/two", selected: true }
  ],
  filterQuery = "",
  getFilteredLinksImpl,
  setCollectedLinksActionImpl = async (links) => ({ ok: true, links })
} = {}) {
  const statuses = [];
  const persistedSnapshots = [];
  let currentLinks = initialLinks.map((link) => ({ ...link }));

  const panelStore = {
    enqueueCollectedLinksPersist(run) {
      return Promise.resolve().then(run);
    }
  };

  const controller = createLinkCurationController({
    panelStore,
    getCollectedLinks: () => currentLinks,
    getResultsFilterQuery: () => filterQuery,
    getFilteredLinksImpl:
      getFilteredLinksImpl ??
      ((links, query) => links.filter((link) => link.url.toLowerCase().includes(query.toLowerCase()))),
    setCollectedLinksActionImpl: async (snapshot) => {
      persistedSnapshots.push(snapshot.map((link) => ({ ...link })));
      return setCollectedLinksActionImpl(snapshot);
    },
    setCollectedLinksState(links) {
      currentLinks = links;
    },
    setStatus(message) {
      statuses.push(message);
    },
    messageFromError(error) {
      return typeof error?.message === "string" ? error.message : null;
    },
    logger: {
      error() {}
    }
  });

  return {
    controller,
    statuses,
    persistedSnapshots,
    get currentLinks() {
      return currentLinks;
    }
  };
}
