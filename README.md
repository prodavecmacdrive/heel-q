# Heel Quest

A 2.5D retro-styled point-and-click adventure game with a companion map editor.  
Built on **Three.js 0.163.0**, **TypeScript (strict)**, and **Vite**.

---

## Table of Contents

1. [Repository Structure](#repository-structure)
2. [Technology Stack](#technology-stack)
3. [How to Run](#how-to-run)
4. [Implemented Systems](#implemented-systems)
5. [Known Issues](#known-issues)

---

## Repository Structure

The monorepo contains two independent Vite/TypeScript packages that share the `assets/` folder at the root.

```
Heel Quest/
├── assets/                  # Shared art & audio (served by both dev servers)
│   ├── audio/               # Sound files (.mp3, .ogg, .wav)
│   ├── data/
│   │   ├── dialogues/       # Dialogue JSON files
│   │   └── maps/            # Legacy / auxiliary map data
│   ├── models/              # 3D models (reserved, empty)
│   ├── sprites/             # Sprite sheets + JSON sidecar metadata
│   └── textures/            # Environment textures (.jpg)
│
├── engine/                  # Game runtime package
│   └── src/
│       ├── main.ts          ← ENTRY POINT — bootstraps Engine, loads world.json
│       ├── data/
│       │   └── world.json   # Live world data written by the editor
│       ├── engine/
│       │   ├── Engine.ts    # Game loop, system registration, startup
│       │   ├── constants.ts # VIRTUAL_WIDTH/HEIGHT, PIXEL_RATIO, COLORS palette
│       │   ├── ecs/         # Entity–Component–System core (Entity, Component, World, System)
│       │   ├── nav/         # A* NavGrid — cell-based pathfinding on the XZ plane
│       │   ├── rendering/   # PixelRenderer (low-res → upscale), TextureManager
│       │   ├── rooms/       # RoomData types, RoomManager (scene builder)
│       │   └── systems/     # All ECS systems (input, movement, animation, camera, …)
│       ├── errors/          # Custom error hierarchy (GameError → InitializationError, etc.)
│       └── tools/
│           └── PlaceholderGenerator.ts  # Procedural pixel-art textures drawn on <canvas>
│
├── tools/
│   └── map_editor/          # Level editor package
│       └── src/
│           ├── main.ts      ← ENTRY POINT — calls EditorApp.init()
│           ├── EditorApp.ts # Master orchestrator: world state, modes, entity/mesh maps, flight mode
│           ├── export/
│           │   └── SceneSerializer.ts  # JSON serialize/deserialize + localStorage + POST to engine
│           ├── types/
│           │   ├── entities.ts  # Discriminated union of all EditorEntity types + factory
│           │   └── scene.ts     # WorldProject, RoomData, DoorDef interfaces (the shared schema)
│           ├── ui/          # Self-contained UI panel classes (MenuBar, TopPanel, LeftPanel, RightPanel, BottomPanel)
│           └── viewport/    # Three.js 3D viewport (ViewportManager, EntityFactory, GizmoController,
│                            #   SelectionManager, WorldMapController, EditorGrid)
│
└── package.json             # Workspace root — dev/dev:engine/dev:editor scripts
```

### Editor → Engine Data Contract

The editor serialises its state as a `WorldProject` JSON object (schema `v1.0.0`) and `POST`s it to `/api/save-world`, which the editor's Vite plugin writes directly to `engine/src/data/world.json`.  
The engine fetches that file at startup and maps it to internal `RoomData` structures.

Key types (defined in `tools/map_editor/src/types/`):

| Type | File | Description |
|---|---|---|
| `WorldProject` | `scene.ts` | Top-level container — `version`, `projectId`, `rooms[]`, `doors[]`, `activeRoomId` |
| `RoomData` | `scene.ts` | One room — `outline` (Vec2 polygon), `entities[]`, `spawnPoints[]`, `walkPadding`, `ambientColor`, `heightMap` |
| `DoorDef` | `scene.ts` | Wall portal — two-point line segment, `room1Id`, `room2Id`, `width`, `texture` |
| `EditorEntity` | `entities.ts` | Discriminated union: `sprite \| animated_sprite \| primitive \| camera \| light \| sound \| trigger \| spawn \| door` |
| `BaseEntity` | `entities.ts` | Shared fields: `id`, `name`, `type`, `transform` (position/rotation/scale as `Vec3`), `visible`, `layer` |

---

## Technology Stack

### Engine (`engine/`)

**Dependencies**

| Package | Version | Purpose |
|---|---|---|
| `three` | `^0.163.0` | 3D scene, geometry, materials, raycasting, WebGL renderer |

**Dev dependencies**

| Package | Version | Purpose |
|---|---|---|
| `typescript` | `^5.4.0` | Type checking, ES2020 compilation |
| `vite` | `^5.2.0` | Dev server (port 3000), HMR, asset serving |
| `@types/three` | `^0.163.0` | TypeScript type definitions for Three.js |

**tsconfig** (`engine/tsconfig.json`)

| Option | Value | Note |
|---|---|---|
| `target` | `ES2020` | Modern JS — uses optional chaining, nullish coalescing |
| `module` | `ESNext` | Native ESM |
| `moduleResolution` | `bundler` | Vite-aware — allows `.ts` import extensions |
| `allowImportingTsExtensions` | `true` | Imports written as `./Foo.ts` (no emit needed) |
| `resolveJsonModule` | `true` | `world.json` imported directly in dev |
| `isolatedModules` | `true` | Each file compiled independently (Vite requirement) |
| `strict` | `true` | All strict checks enabled |
| `noEmit` | `true` | tsc is type-check only; Vite handles transpilation |
| `noUnusedLocals/Params` | `false` | Intentionally relaxed during active development |

**Vite config** (`engine/vite.config.ts`)
- Port `3000`
- `fs: { allow: ['..'] }` — allows serving files from the monorepo root (shared `assets/`)
- Custom plugin `serve-shared-assets` — intercepts `GET /assets/*` and serves from workspace-root `assets/` with correct MIME types

---

### Map Editor (`tools/map_editor/`)

**Dependencies**

| Package | Version | Purpose |
|---|---|---|
| `three` | `^0.163.0` | 3D editor viewport, gizmos, raycasting |

**Dev dependencies**

| Package | Version | Purpose |
|---|---|---|
| `typescript` | `^5.4.0` | Type checking |
| `vite` | `^5.2.0` | Dev server (port 3001), HMR |
| `@types/three` | `^0.163.0` | Three.js type definitions |

**tsconfig** — identical to engine (same options, same targets).

**Vite config** (`tools/map_editor/vite.config.ts`)
- Port `3001`
- Custom plugin `save-world-plugin` with two middleware endpoints:
  - `POST /api/save-world` — receives serialised `WorldProject` JSON, writes it to `../../engine/src/data/world.json`
  - `GET /api/assets` — scans `../../assets/{sprites,textures,audio}`, returns `{ sprites, textures, audio }` array (hidden files excluded; animated sprites detected by `.json` sidecar)
- Same `serve-shared-assets` plugin for `GET /assets/*`

---

## How to Run

### Prerequisites

- **Node.js ≥ 18** (ESM support, `fetch` built-in)
- No environment variables required for local development

### Install

Each package has its own `node_modules`. Install both:

```bash
cd engine && npm install
cd ../tools/map_editor && npm install
```

### Start dev servers

From the **repo root** (runs both in parallel):

```bash
npm run dev
```

Or individually:

```bash
npm run dev:engine    # → http://localhost:3000  (game)
npm run dev:editor    # → http://localhost:3001  (editor)
```

### Build for production

```bash
# Inside each package folder
npm run build   # tsc (type-check) then vite build
```

### Live edit → play loop

1. Start both servers.
2. Make changes in the editor at `http://localhost:3001` and save (`Ctrl+S` or the Save button).
3. The editor POSTs to `/api/save-world`, which overwrites `engine/src/data/world.json`.
4. The engine dev server hot-reloads and picks up the new world on next page load.

> No test runner is configured. TypeScript (`tsc --noEmit`) is the only automated quality check.

---

## Implemented Systems

### Engine

| System | File | Status | Description |
|---|---|---|---|
| ECS Core | `engine/ecs/` | ✅ Working | `World` (sparse component storage), typed `addComponent`/`getComponent` via `ComponentRegistry`, deferred entity deletion |
| InputSystem | `systems/InputSystem.ts` | ✅ Working | Pointer-down raycasting through PixelRenderer viewport; floor click → A* path; door click → `pendingPortalId` |
| MovementSystem | `systems/MovementSystem.ts` | ✅ Working | Waypoint queue follower; toggles walk/idle animation state |
| PortalSystem | `systems/PortalSystem.ts` | ✅ Working | Detects player arrival at portal boundary → async room transition via RoomManager |
| AnimationSystem | `systems/AnimationSystem.ts` | ✅ Working | Sprite-sheet frame counter; UV offsets (row-major, bottom-left origin correction) |
| SpriteSystem | `systems/SpriteSystem.ts` | ✅ Working | Camera billboarding; discrete Z-depth scaling (quantised 0.05 steps); feet-first Y offset |
| DepthSortSystem | `systems/DepthSortSystem.ts` | ✅ Working | `renderOrder = round(feetZ × 1000)`; disables `depthTest` on sprite materials |
| CameraSystem | `systems/CameraSystem.ts` | ✅ Working | Multi-camera entities; number-key switching (1–9); LookAt target tracking; room-change detection |
| PixelSnapSystem | `systems/PixelSnapSystem.ts` | ✅ Working | Snaps world positions to `1/PIXEL_RATIO` (0.125 unit) grid |
| RenderSystem | `systems/RenderSystem.ts` | ✅ Working | Calls `PixelRenderer.render()` each frame |
| PixelRenderer | `rendering/PixelRenderer.ts` | ✅ Working | Two-pass pipeline: render to 480×270 `WebGLRenderTarget` → upscale with letterboxing |
| TextureManager | `rendering/TextureManager.ts` | ✅ Working | All textures: `NearestFilter`, no mipmaps, SRGB colorspace |
| NavGrid (A*) | `nav/NavGrid.ts` | ✅ Working | Cell-based A* on XZ plane (cell size 0.5 units); 8-direction movement with corner-cut prevention; octile heuristic; path simplification; `stampObstacle()` |
| RoomManager | `rooms/RoomManager.ts` | ✅ Working | Builds room scene from `RoomData`: floor ShapeGeometry, wall planes, NavGrid, entity spawning (sprites, primitives, lights, doors, cameras), player preserve/reposition |
| PlaceholderGenerator | `tools/PlaceholderGenerator.ts` | ✅ Working | Procedurally draws 30+ pixel-art textures (floors, walls, characters, props) onto `<canvas>` at startup |
| Error hierarchy | `errors/` | ✅ Working | `GameError → InitializationError → ResourceNotFoundError → RoomNotFoundError, WorldLoadError` |

### Map Editor

| Feature | File(s) | Status | Description |
|---|---|---|---|
| World map mode | `viewport/WorldMapController.ts` | ✅ Working | Top-down orthographic view; draw room outlines as polygons; vertex drag with 0.5-unit grid snap and wall-edge snap (threshold 2.0); door tool (two-click line segment) |
| Room mode | `EditorApp.ts` + `viewport/` | ✅ Working | Perspective 3D entity placement inside the active room |
| Height mode | `EditorApp.ts` | ⚠️ Stub | Mode exists in the switcher but has no implementation |
| Entity placement | `EditorApp.ts`, `EntityFactory.ts` | ✅ Working | Drag-and-drop from content browser; all 9 entity types supported |
| Transform gizmos | `viewport/GizmoController.ts` | ✅ Working | Three.js `TransformControls` for translate/rotate/scale; orbit locked during drag |
| Entity selection | `viewport/SelectionManager.ts` | ✅ Working | Raycaster picking; blue `BoxHelper` highlight; callbacks for property inspector |
| Property inspector | `ui/RightPanel.ts` | ✅ Working | Type-specific input fields, Vec3 grids, color pickers, collapsible sections, delete button |
| Content browser | `ui/BottomPanel.ts` | ✅ Working | Tabs: Assets / Primitives / Functional; async fetch from `/api/assets`; animated-sprite detection |
| Flight mode | `EditorApp.ts` | ✅ Working | Possess a camera entity — WASD + mouse-look (pointer lock); saves transform back on Escape |
| Serialization | `export/SceneSerializer.ts` | ✅ Working | JSON schema v1.0.0; `localStorage` persistence; POST to engine; download/import file |
| Paint tool | `ui/LeftPanel.ts` | ⚠️ Stub | Button rendered but click is silently ignored (`// stubs`) |
| Terrain tool | `ui/LeftPanel.ts` | ⚠️ Stub | Button rendered but click is silently ignored (`// stubs`) |

---

## Known Issues

### TypeScript Suppressions / Untyped Code

The engine's world-data mapper in `engine/src/main.ts` treats the entire `world.json` structure as `any` — no compile-time validation against the editor's `WorldProject` type. Lines flagging this:

| File | Lines | Description |
|---|---|---|
| `engine/src/main.ts` | 41, 155, 166–168, 307, 358, 387, 411 | `world.json` parsed and iterated with `(r: any)`, `(e: any)`, `(cam: any)` casts throughout the mapper block |
| `tools/map_editor/src/EditorApp.ts` | 561, 603 | `geometryType` forced with `as any` on drag-drop entity creation |
| `tools/map_editor/src/EditorApp.ts` | 686 | `(e as any).spawnId` — accesses a property not in the typed interface |
| `tools/map_editor/src/EditorApp.ts` | 772, 822 | `(this as any)._flightMouseHandler` — dynamic property stored on the class instance to work around missing declaration |
| `engine/vite.config.ts` | 31 | Connect middleware typed `(req: any, res: any, next: any)` |
| `tools/map_editor/vite.config.ts` | 30 | Same pattern |

### Hardcoded / Magic Values

| Location | Value | Issue |
|---|---|---|
| `engine/src/engine/rooms/RoomManager.ts` | `SHEET_META` constant (lines 12–35) | Sprite-sheet layouts for `elias_sheet`, `vance_sheet`, `dog_sheet`, `scifi_sheet` are hardcoded — adding a new sprite sheet requires editing this file directly |
| `engine/src/engine/nav/NavGrid.ts` | `const CELL_SIZE = 0.5` | Module-level constant, not exported — systems that need to reason about cell size must re-derive it |
| `engine/src/engine/systems/DepthSortSystem.ts` | `round(feetZ × 1000)` | The 1000 multiplier is an undocumented scale factor |
| `engine/src/engine/systems/SpriteSystem.ts` | `0.05` discrete scale step | Not in `constants.ts`; `SCALE_STEPS` array exists but the step size is implicit |
| `tools/map_editor/src/viewport/WorldMapController.ts` | Snap grid `0.5`, edge-snap threshold `2.0` | Magic numbers inline in mouse-event handlers |
| `tools/map_editor/src/viewport/EditorGrid.ts` | `50` (grid size), `0.25` (sub-grid step) | Hardcoded in constructor |
| `engine/src/main.ts` | `'scifi_sheet'` fallback (line 270) | Default character asset is a string literal, not a constant |

### Structural Issues

- **No shared type package.** The `WorldProject` / `RoomData` / `EditorEntity` types are defined in `tools/map_editor/src/types/` only. The engine's `main.ts` re-maps the same data via `any` casts rather than importing the canonical types. `tools/shared_core/` exists but is empty. A true shared package would eliminate the runtime mismatch risk.

- **Single-file mapper.** `engine/src/main.ts` contains ~400 lines of world-to-engine mapping logic mixed with bootstrap code. Any schema change requires editing this file, which also owns engine startup.

- **Flight-mode event handler stored as `any`.** `EditorApp` stores the pointer-lock mouse handler on `(this as any)._flightMouseHandler` because it isn't declared as a class property. If `exitFlightMode()` is called before `enterFlightMode()` completes, the handler reference is lost.

- **`heightMap` field unused.** `RoomData.heightMap: number[]` is serialised by the editor and declared in the schema, but the engine's `RoomManager` never reads it. The Height mode in the editor is also a stub.

- **`activeRoomId` round-trips through JSON.** `WorldProject.activeRoomId` is an editor-internal cursor that gets written to `world.json` and loaded by the engine, where it has no meaning.

- **Asset path normalisation in `main.ts`.** Windows backslash → forward-slash conversion and `assets/` prefix stripping are done with raw string `.replace()` at lines ~125–140. This is fragile if path formats from the editor change.
