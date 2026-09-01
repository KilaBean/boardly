# ADR 0001 — Foundation toolchain version pinning

- **Status:** Accepted
- **Date:** 2026-08-24
- **Phase:** 1 (Foundation)

## Context

Boardly targets Next.js 16 with React 19. Several packages in this stack had a
`latest` version that is **not** compatible with the rest of the toolchain, so
installing "the newest of everything" produces a subtly broken project.

## Decisions

### 1. TypeScript pinned to 5.9.3 (not 7.x)

`typescript@latest` is **7.0.2**, the native/Go compiler rewrite. However
`eslint-config-next@16.3.2` depends on `typescript-eslint@^8.46.0`, which
declares `typescript: ">=4.8.4 <6.1.0"`.

Installing TS 7 leaves type-aware linting silently broken. TS 6.0.3 is inside
the supported range, but Next 16's own template pins `^5`, so TS 5 is the line
actually tested against this toolchain.

**Revisit when** `typescript-eslint` widens its peer range to TS 7.

### 2. ESLint pinned to 9.39.5 despite the EOL notice

npm flags `eslint@9.39.5` as "no longer supported". We nonetheless stay on 9.x:
ESLint 10 crashes on this config with
`TypeError: contextOrFilename.getFilename is not a function`, thrown from
`eslint-plugin-react`, which `eslint-config-next` bundles. The latest
`eslint-plugin-react` (7.37.5) declares `eslint: ^3 || … || ^9.7` — it does not
support ESLint 10 at all, so no override resolves this.

A working lint gate on an EOL minor beats a broken one on a current major.

**Revisit when** `eslint-plugin-react` ships ESLint 10 support.

### 3. jsdom pinned to 29.1.1

`jsdom@30` requires Node `^22.22.2 || ^24.15.0 || >=26`. The development machine
runs Node 24.14.0. jsdom 29.1.1 requires `>=24.0.0` and installs cleanly.

**Revisit when** the toolchain's Node baseline moves to 24.15+.

### 4. E2E runs against a production build

Playwright's `webServer` always runs `npm run build && npm run start`, including
locally. Against the dev server, `/_next` assets returned `403` and the HMR
websocket handshake failed; the failing chunk loads prevented hydration, so the
theme dropdown never opened. Both are dev-only artifacts.

Asserting "no console errors" against a server that reliably emits console
errors would train us to ignore the assertion. Testing the built artifact also
matches what ships. The cost is a slower E2E loop.

### 5. `vite-tsconfig-paths` removed

Vite 8 resolves `tsconfig` path aliases natively via `resolve.tsconfigPaths`.
The plugin was redundant, and its transitive `tsconfck` dependency is flagged
unmaintained. Removing it also cut unit-test wall time from ~40s to ~3s.

## Open question — deferred to Phase 3/4

**There is no `@liveblocks/react-tldraw` package.** Binding tldraw to Liveblocks
requires choosing between:

1. `@liveblocks/yjs` + Yjs bound to the tldraw store — keeps Liveblocks as the
   single real-time provider, consistent with presence and room authorization.
2. `@tldraw/sync` — tldraw's own sync layer, which would introduce a second
   real-time system and a second authorization surface.

Option 1 is the presumptive choice because it preserves the critical invariant
that room access derives from Postgres membership. **No decision is recorded
yet**, and neither package is installed. This must be resolved before Phase 4.
