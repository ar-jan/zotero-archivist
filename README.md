# zotero-archivist

A Chromium browser extension to collect links from a web page and archive selected pages to Zotero via the Zotero Connector browser plugin.

## Prerequisites

- Have [Zotero](https://www.zotero.org/download/) installed
- Have the official [Zotero Connector](https://chromewebstore.google.com/detail/zotero-connector/ekhagklcjbdpajgpjgmbionohlpdbjgc) installed

## Installation

- Git clone this repository (or download and unpack the ZIP version)
- Enable `Developer mode` on your browser's extension page
- Click `Load unpacked` and point it at your copy of `zotero-archivist`

## Usage

- Toggle the `ZA` extension icon to open the side panel
- Use `All anchor links` or create your own selector rules
- Click `Collect Links` and give the extension permission to access the page
- Select URLs to add to the download queue
- To process the queue, make sure Zotero is running (all three integration status indicators should be green)

## Documentation

- [Side panel screenshot](docs/zotero-archivist-sidepanel-reddit-datahoarder.png)
- Architecture and design overview: `docs/ARCHITECTURE.md`

## Development

```sh
# Run all tests:
npm test
```
