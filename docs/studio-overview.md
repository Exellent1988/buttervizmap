# ButterVizMap Studio Overview

## What this repository contains

ButterVizMap is a Butterchurn-based video-mapping studio focused on browser delivery and projector-style output workflows. The repository now contains two layers:

- The original Butterchurn rendering core in [`src/`](/Users/axell/Documents/Projects/ButterVizMap/src)
- A new studio runtime in [`studio/`](/Users/axell/Documents/Projects/ButterVizMap/studio)

The studio runtime introduces:

- A control route at `/admin`
- A dedicated output route at `/output/:sessionId`
- A lightweight LAN server with WebSocket session sync
- A project model for scenes, presets, mapping elements and output settings
- A composition pipeline that combines global shaders, local shader surfaces, clip masks, paint layers and interaction fields

## Element model

The editor uses a unified `SceneElement` object instead of separate mask classes. Each element has geometry plus a set of roles:

- `clip`: cuts away pixels from the final composition
- `paint`: draws visible color or wash layers
- `shaderSurface`: renders a dedicated local shader inside the element geometry
- `interactionField`: contributes mask/color/distance information to the interaction pass

This makes it possible to reuse the same polygon or quad as a visible layer, a clip region and a shader interaction driver.

## Rendering model

The compositor works in passes:

1. Render a global base shader
2. Rasterize interaction buffers
3. Draw paint elements
4. Draw local shader surfaces clipped to their geometry
5. Apply clip elements
6. Blend interaction color and distance passes over the final output

The current implementation keeps the interaction contract standardized:

- alpha / mask
- color
- distance / falloff

That keeps the editor and the network protocol stable even when the underlying Butterchurn integration evolves.

## Presets

v1 intentionally avoids raw preset-code editing in the UI. Instead, the project stores serializable preset library entries that reference built-in preset templates plus UI-safe overrides.

Built-in templates are defined in [`studio/shared/defaultPresets.js`](/Users/axell/Documents/Projects/ButterVizMap/studio/shared/defaultPresets.js).

The runtime now supports three preset source types:

- `solid`: flat color backgrounds for the global layer
- `builtin`: curated studio presets shipped with the app
- `file`: JSON presets loaded from the repository preset catalog

The admin UI exposes a preset browser with:

- a `Starter` scope for a smaller curated subset
- an `All presets` scope for the full catalog
- source-specific scopes for studio, repo, and solid presets
- search across preset names, file ids, and derived author labels

The main preset source is now the converted catalog shipped by the `butterchurn-presets` package, which is the same family of presets exposed by `butterchurnviz.com`. The older repository JSON directory remains available as a fallback source.

In Docker deployments, the preset JSON files are bundled into the image so `/api/presets` behaves the same way as a local checkout.

## Editor workflow

The admin editor is canvas-first:

- click an element directly on the preview canvas to select it
- drag inside an element to move the whole shape
- click a point to select it and move it with the arrow keys
- double-click inside a polygon to add a point

Inspector controls include tooltips, and native color inputs are kept stable during live edits so the browser color picker does not collapse on every value change.

Shader surfaces also expose mapping and reaction controls:

- opacity
- blend mode
- scale
- offset X / Y
- rotation
- interaction mix
- reaction mode (`tint`, `pulse`, `warp`, `glow`)

Interaction fields expose:

- alpha
- distance
- influence
- pulse
- swirl

Those values now feed the compositor so interaction fields do more than tint the final frame. They can push, pulse, rotate, and recolor both the global Butterchurn layer and local shader surfaces.

## Rendering and preset flow controls

The session panel now also exposes ButterchurnViz-style runtime controls:

- frame limit
- canvas size / internal texture scale
- mesh width / height
- preset cycling enable
- preset cycle interval
- randomize next preset
- auto preset blend duration
- manual preset blend duration

These values are stored in the project file and affect both the admin preview and the output viewer route.

## Project files

Project files are versioned JSON documents with:

- `meta`
- `output`
- `globalLayer`
- `presetLibrary`
- `elements`
- `scenes`

The browser stores an autosave copy locally, and the same structure can be exported and re-imported.
