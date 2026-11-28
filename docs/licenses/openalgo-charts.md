# OpenAlgo Charts dependency audit

Audited package: `openalgo-charts@2.7.5` (exact version, no range).

## License and package metadata

- npm package name/version: `openalgo-charts@2.7.5`
- Module format: ESM (`"type": "module"`)
- Runtime requirement declared by the package: Node.js 20 or newer
- Declared and shipped license: Apache License 2.0
- The npm tarball contains both `LICENSE` and `NOTICE`. The notice identifies
  OpenAlgo Charts, copyright 2026 OpenAlgo, and must remain available with any
  redistribution that requires Apache-2.0 notices.
- The package declares no React peer dependency. It exposes a DOM-based chart
  constructor, so WaveKB integrates it from a client lifecycle instead of as a
  React renderer.

The installed package and the npm `2.7.5` tarball were checked independently;
their name, version, license declaration, export map, and shipped notices agree.

## Public exports used by WaveKB

WaveKB imports only documented export-map entries:

| Package export | Audited public surface used by the adapter |
| --- | --- |
| `openalgo-charts` | `createChart`; chart/series methods for candles, markers, indicators, viewport, and `destroy()` |
| `openalgo-charts/indicators` | side-effect registration of the built-in indicator catalog; `registerBuiltinIndicators` and 113 descriptors are public exports |
| `openalgo-charts/draw` | `DrawingController` placement/cancel/undo/redo, its JSON document boundary and `destroy()`; `hasDrawingTool()` public registry |

WaveKB does not import undocumented files, `openalgo-charts/trade`, the widget,
an OpenAlgo backend, or any broker command surface. Application code must import
the dependency only through
`apps/web/src/lib/trading/chart-engine.ts`.

## Drawing identifiers

After importing the public `openalgo-charts/draw` tier, an executable contract
test checks the public `hasDrawingTool()` registry for every identifier exposed
by the WaveKB adapter. This includes the five required manual Elliott tools:

- `elliott-impulse`
- `elliott-correction`
- `elliott-triangle`
- `elliott-double-combo`
- `elliott-triple-combo`

These are drawing identifiers only. WaveKB does not provide automatic Elliott
wave counting or trading recommendations.

The same registry contract covers WaveKB's bounded basic, position, and
Fibonacci tool allowlists. The adapter maps controller documents into the
versioned `wavekb-chart-drawings-v1` shape and drops library-only fields before
notifying application listeners; callers never receive the controller or its
opaque state.

## React and Next.js compatibility

The package README documents React and Next.js lifecycle integration: create a
chart after mount and call `destroy()` on unmount. The local Next.js 16 guide for
lazy loading requires browser-only external libraries to be loaded with dynamic
`import()` from a Client Component and notes that `ssr: false` is valid only at a
Client Component boundary.

The WaveKB adapter therefore:

- loads the root, indicator and drawing tiers with literal dynamic imports;
- rejects creation when no browser `window`/`document` is present;
- owns one candle series and marker layer;
- exposes an idempotent `destroy()` that tears down drawings before the chart;
- persists only WaveKB-owned inputs, not the library's opaque chart state.

The UI integration must dynamically load its Client Component with SSR disabled;
that component work is intentionally outside this dependency-boundary task.

## Upgrade rule

Any version change requires a fresh review of the npm tarball, `LICENSE`,
`NOTICE`, export map, Next.js/client lifecycle, all five Elliott identifiers,
adapter contract tests, bundle impact, and the prohibition on trade commands.
