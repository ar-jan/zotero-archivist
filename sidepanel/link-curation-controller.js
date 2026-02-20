export function createLinkCurationController({
  panelStore,
  getCollectedLinks,
  getResultsFilterQuery,
  getFilteredLinksImpl,
  setCollectedLinksActionImpl,
  setCollectedLinksState,
  setStatus,
  messageFromError,
  logger = console
}) {
  async function handleResultsListChange(event) {
    const target = event?.target;
    if (!isResultSelectionInputTarget(target)) {
      return;
    }

    const linkId = typeof target.dataset?.linkId === "string" ? target.dataset.linkId : "";
    if (linkId.length === 0) {
      return;
    }

    const nextSelected = target.checked;
    const selectionResult = updateSingleLinkSelection(getCollectedLinks(), linkId, nextSelected);
    if (selectionResult.changedCount === 0) {
      return;
    }

    setCollectedLinksState(selectionResult.nextLinks);
    const persisted = await persistCollectedLinks();
    if (persisted) {
      setStatus(`${nextSelected ? "Selected" : "Cleared"} 1 link.`);
    }
  }

  async function setFilteredLinksSelectedState(nextSelectedState) {
    const currentLinks = getCollectedLinks();
    const filteredLinks = getFilteredLinksImpl(currentLinks, getResultsFilterQuery());
    if (filteredLinks.length === 0) {
      setStatus("No links match the current filter.");
      return;
    }

    const selectionResult = updateFilteredLinkSelection(currentLinks, filteredLinks, nextSelectedState);
    if (selectionResult.changedCount === 0) {
      setStatus(
        nextSelectedState
          ? "Filtered links are already selected."
          : "Filtered links are already deselected."
      );
      return;
    }

    setCollectedLinksState(selectionResult.nextLinks);
    const persisted = await persistCollectedLinks();
    if (persisted) {
      setStatus(`${nextSelectedState ? "Selected" : "Deselected"} ${selectionResult.changedCount} filtered link(s).`);
    }
  }

  async function invertFilteredLinkSelection() {
    const currentLinks = getCollectedLinks();
    const filteredLinks = getFilteredLinksImpl(currentLinks, getResultsFilterQuery());
    if (filteredLinks.length === 0) {
      setStatus("No links match the current filter.");
      return;
    }

    const selectionResult = invertFilteredLinkSelectionState(currentLinks, filteredLinks);
    setCollectedLinksState(selectionResult.nextLinks);
    const persisted = await persistCollectedLinks();
    if (persisted) {
      setStatus(`Inverted selection for ${selectionResult.changedCount} filtered link(s).`);
    }
  }

  async function clearCollectedLinks() {
    const currentLinks = getCollectedLinks();
    const removedCount = currentLinks.length;
    if (removedCount === 0) {
      setStatus("No collected links to clear.");
      return;
    }

    setCollectedLinksState([]);
    const persisted = await persistCollectedLinks();
    if (persisted) {
      setStatus(`Cleared ${removedCount} collected link(s).`);
    }
  }

  async function persistCollectedLinks() {
    const snapshot = getCollectedLinks().map((link) => ({ ...link }));

    return panelStore.enqueueCollectedLinksPersist(async () => {
      try {
        const response = await setCollectedLinksActionImpl(snapshot);
        if (!response || response.ok !== true) {
          setStatus(messageFromError(response?.error) ?? "Failed to save curated links.");
          return false;
        }

        setCollectedLinksState(response.links);
        return true;
      } catch (error) {
        logger.error("[webpage-archivist] Failed to persist curated links.", error);
        setStatus("Failed to save curated links.");
        return false;
      }
    });
  }

  return {
    handleResultsListChange,
    setFilteredLinksSelectedState,
    invertFilteredLinkSelection,
    clearCollectedLinks
  };
}

export function isResultSelectionInputTarget(target) {
  if (!target || typeof target !== "object") {
    return false;
  }

  if (typeof target.checked !== "boolean") {
    return false;
  }

  const contains = target.classList?.contains;
  return typeof contains === "function" && contains.call(target.classList, "result-selected-input");
}

export function updateSingleLinkSelection(links, linkId, nextSelected) {
  let changedCount = 0;
  const nextLinks = links.map((link) => {
    if (link.id !== linkId) {
      return link;
    }

    const currentSelected = link.selected !== false;
    if (currentSelected === nextSelected) {
      return link;
    }

    changedCount += 1;
    return {
      ...link,
      selected: nextSelected
    };
  });

  return {
    nextLinks,
    changedCount
  };
}

export function updateFilteredLinkSelection(links, filteredLinks, nextSelectedState) {
  const filteredIds = new Set(filteredLinks.map((link) => link.id));
  let changedCount = 0;

  const nextLinks = links.map((link) => {
    if (!filteredIds.has(link.id)) {
      return link;
    }

    const currentSelected = link.selected !== false;
    if (currentSelected === nextSelectedState) {
      return link;
    }

    changedCount += 1;
    return {
      ...link,
      selected: nextSelectedState
    };
  });

  return {
    nextLinks,
    changedCount
  };
}

export function invertFilteredLinkSelectionState(links, filteredLinks) {
  const filteredIds = new Set(filteredLinks.map((link) => link.id));
  let changedCount = 0;

  const nextLinks = links.map((link) => {
    if (!filteredIds.has(link.id)) {
      return link;
    }

    changedCount += 1;
    return {
      ...link,
      selected: link.selected === false
    };
  });

  return {
    nextLinks,
    changedCount
  };
}
