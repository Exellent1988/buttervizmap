# Testing Guide

## Automated coverage

The new studio layer is backed by automated tests that can run in CI without manual browser setup:

- Project schema and roundtrip tests
- Geometry and composition-plan tests
- Protocol serialization tests
- Local LAN sync server tests with real WebSocket clients

Relevant tests live in [`test/studio/`](/Users/axell/Documents/Projects/ButterVizMap/test/studio).

## Commands

Install dependencies first:

```bash
pnpm install
```

Run the studio-focused automated suite:

```bash
pnpm test:studio
```

Run the full unit suite without visual regression:

```bash
pnpm test:unit
```

Run the existing visual regression suite:

```bash
pnpm test:visual
```

## What the tests verify

`project.test.js`

- default project structure
- import/export roundtrips
- scene recall behavior
- preset duplication behavior

`geometry-composition.test.js`

- geometry normalization
- polygon hit testing
- distance-to-edge calculations
- render-plan generation
- interaction field summarization

`protocol-server.test.js`

- message serialization
- deep patch merging
- audio frame encoding/decoding
- admin-to-viewer sync over the local WebSocket server
- HTTP preset-catalog serving from `/api/presets`

When the environment forbids binding local ports, the protocol test falls back to an `EPERM` guard instead of hanging indefinitely. On a normal local machine or in CI, the full socket and HTTP integration coverage still runs.

## Recommended next testing layers

The current suite covers the new studio architecture with deterministic unit and integration tests. The next useful additions would be:

- Browser-level interaction tests for the admin editor
- Snapshot tests for output composition
- End-to-end tests that open both `/admin` and `/output/:sessionId`
