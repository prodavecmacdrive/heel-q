# Project Instructions

This file captures workspace-specific guidance for Copilot and related agents.

- Update this file whenever architecture, editor tooling, or style conventions change.
- Include new architectural decisions, map editor behavior, and game editing tool descriptions.
- Keep the guidance actionable and concise so future changes can be made without repeated context questions.

---

## Project Overview

**Heel Quest** is a 2.5D retro-styled point-and-click adventure game with a companion map editor. The project is a monorepo with two main applications sharing asset data:

| Application | Location | Port | Purpose |
|---|---|---|---|
| Game Engine | `engine/` | 3000 | Three.js game runtime with ECS architecture and pixel-art rendering pipeline |
| Map Editor | `tools/map_editor/` | 3001 | Three.js level editor for room layout, entity placement, and world management |

Both apps use **Three.js 0.163.0**, **TypeScript (strict, ES2020)**, and **Vite** as bundler.

---

## Build & Dev

```bash
# From repo root — run both apps simultaneously
npm run dev

# Individual apps
npm run dev:engine    # engine only  → http://localhost:3000
npm run dev:editor    # editor only  → http://localhost:3001

# Build (inside each app folder)
npm run build         # tsc && vite build
```

> **No test runner is configured.** TypeScript type-checking is the only automated check (`tsc`).

> **Live sync**: The editor's Vite plugin intercepts `POST /api/save-world` and writes directly to `engine/src/data/world.json`. Both servers must be running for the full edit→play loop.

---

## Engine Architecture (`engine/src/`)

### Bootstrap Flow
`main.ts` → creates canvas → instantiates `Engine` → generates placeholder textures via `PlaceholderGenerator` → fetches `world.json` from `/src/data/` → maps editor `WorldProject` format to engine `RoomData` → registers rooms → starts game loop.

### ECS (Entity–Component–System)
All gameplay logic uses a custom ECS in `engine/ecs/`:

- **Entity** (`Entity.ts`): `Entity = number` – type alias, incremental ID.
- **Component** (`Component.ts`): Typed data bags registered in a `ComponentRegistry` interface for compile-time safety. Key components:
  - `Transform` – position (Vector3), rotation (Euler), scale (Vector3). **Position is at the entity's feet** (bottom-center), not center.
  - `Sprite` – textureKey, frame index, base dimensions, discrete scale offset.
  - `MeshRenderer` – wraps `THREE.Object3D`.
  - `Player` – path (waypoint queue), speed, isMoving flag, floorY, pendingPortalId.
  - `SpriteAnimation` – columns, rows, totalFrames, currentFrame, frameRate, state ('idle' | 'walk'), stateFrames map.
  - `Collider`, `Portal`, `Interactable`, `RoomMember` – gameplay markers.
  - `FloorMarker`, `Obstacle` – boolean tag components (marker pattern).
  - `DoorMarker` – door entity marker with `targetRoomId`, `targetSpawnId`, `interactionState` ('open' | 'closed' | 'locked').
  - `CameraMarker` – multi-camera entity marker with `cameraIndex`, `isDefault`, `targetLookAt` (entity ID), `fov`.
- **System** (`System.ts`): Abstract base with `update(dt, entities?)`. All systems hold a `World` ref.
- **World** (`World.ts`): Sparse component storage (`Map<ComponentName, Map<Entity, Data>>`). Deferred entity deletion. Type-safe `addComponent<T>()` / `getComponent<T>()` via `ComponentRegistry`.

### System Execution Order (registered in `Engine.start()`)
1. **InputSystem** – pointer-down raycasting; floor click → A* path; door click → sets pendingPortalId.
2. **MovementSystem** – follows waypoint path at `player.speed`; toggles walk/idle animation state.
3. **PortalSystem** – detects arrival at portal boundary → async room transition via RoomManager.
4. **AnimationSystem** – ticks sprite-sheet frame counter; updates UV offsets (row-major layout, bottom-left origin correction).
5. **SpriteSystem** – billboarding (`mesh.quaternion = camera.quaternion`), discrete Z-depth scaling (quantized 0.05 steps), feet-first Y offset.
6. **DepthSortSystem** – sets `renderOrder = round(feetZ × 1000)`, disables depthTest on sprite materials.
7. **CameraSystem** – multi-camera management; number key switching (1-9); LookAt target tracking; room change detection.
8. **PixelSnapSystem** – snaps positions to `1/PIXEL_RATIO` (1/8 world unit) grid.
9. **RenderSystem** – calls `PixelRenderer.render()`.

### Rendering Pipeline (`engine/rendering/`)
- **PixelRenderer**: Two-pass low-res → upscale pipeline.
  - Pass 1: Render scene to 480×270 `WebGLRenderTarget` (nearest-neighbor).
  - Pass 2: Full-screen quad with letterboxing to maintain 16:9.
  - Exposes `viewportX/Y/Width/Height` for InputSystem screen→NDC mapping.
- **TextureManager**: All textures forced to `NearestFilter`, no mipmaps, SRGB colorspace.
- **Virtual resolution**: 480×270 pixels, `PIXEL_RATIO = 8` (1 world unit = 8 px).

### Navigation (`engine/nav/`)
- **NavGrid**: Cell-based A* on XZ plane (cell size 0.5 units).
  - 8-direction movement with corner-cutting prevention.
  - Octile heuristic. Path simplification removes collinear waypoints.
  - `stampObstacle()` marks cells blocked by entities.
  - Fallback: returns goal position if no path found.

### Room Management (`engine/rooms/`)
- **RoomData**: Type interface for room schema – boundary outline, entities, portals, `cameras: CameraDef[]`, spawn points, `characterSpeed`, `characterAsset`.
- **CameraDef**: Multi-camera definition – `id`, `position`, `rotation`, `fov`, `near`, `far`, `isDefault`, `targetLookAt` (empty string = use euler rotation, entity ID = track target).
- **RoomManager**: Builds room scene from RoomData:
  1. Preserves existing Player entity across loads.
  2. Spawns camera entities from `cameras[]` array; applies default camera; falls back to legacy single-camera fields.
  3. Generates ShapeGeometry floor + wall planes from vectorized outline.
  4. Builds NavGrid, stamps obstacles.
  5. Spawns entities by type (primitive geometry, lights, sprites with sheet metadata, **3D door entities**).
  6. Creates door meshes for portals.
  7. Spawns or repositions player at spawn point; applies `characterSpeed` / `characterAsset` from room data.
  - `spawnDoorEntity3D()` – creates BoxGeometry door with texture/UV support and DoorMarker component.
  - `spawnCameraEntity()` – creates ECS entity with CameraMarker.
  - `applyCameraDef()` – sets camera position/rotation/FOV from CameraDef.
  - Sprite sheet metadata is hardcoded in `SHEET_META` for known sheets (elias, vance, dog, scifi).

### Error Hierarchy (`engine/errors/`)
- `GameError` (base, captures stack + optional cause) → `InitializationError` → `ResourceNotFoundError` → `RoomNotFoundError`, `WorldLoadError`.
- All re-exported from `errors/index.ts`.

### Placeholder Assets (`engine/tools/PlaceholderGenerator.ts`)
- Procedurally draws 30+ textures on `<canvas>`: floor tiles, wall bricks, character sprite sheets (4×2 frames), props (desk, lamp, cabinet), lab aesthetics.
- Registered directly as `THREE.CanvasTexture` via TextureManager.

### Constants (`engine/constants.ts`)
- `VIRTUAL_WIDTH = 480`, `VIRTUAL_HEIGHT = 270`, `PIXEL_RATIO = 8`.
- `COLORS`: palettes for procedural asset generation.

---

## Map Editor Architecture (`tools/map_editor/src/`)

### Bootstrap
`main.ts` → `EditorApp.init()`.

### EditorApp (`EditorApp.ts`) – Master Orchestrator
Manages all state: `WorldProject`, `activeRoom`, `currentMode`, `entityMap`, `meshMap`.
- **Modes**: `'world'` (orthographic top-down room layout), `'room'` (perspective 3D entity placement), `'height'` (stub).
- **Key methods**: `selectRoom()`, `rebuildRoomView()`, `rebuildFloorAndWalls()`, `addEntity()`, `removeEntity()`, `handleMenuAction()`, `handleToolChange()`, `addEntityFromBrowser()`.
- **Flight mode**: `enterFlightMode()` / `exitFlightMode()` – possess a camera entity for WYSIWYG framing. WASD movement, mouse look with pointer lock, Escape to exit. Saves camera transform back to entity on exit.
- Rotation stored in **degrees** internally; converted to radians for Three.js.

### Type System (`types/`)
- **entities.ts**: Discriminated union – `EntityType = 'sprite' | 'animated_sprite' | 'primitive' | 'camera' | 'light' | 'sound' | 'trigger' | 'spawn' | 'door'`. Each has typed properties. `Vec3 { x, y, z }` used for JSON-safe vectors.
  - `DoorEntity` – 3D door with `targetRoomId`, `targetSpawnId`, `interactionState` ('open' | 'closed' | 'locked'), material/texture/UV fields.
  - `PrimitiveEntity` – expanded with `textureSource`, `uvTilingX/Y`, `uvOffsetX/Y`, sequence animation fields.
  - `SpawnEntity` – expanded with `characterSpeed`, `characterAsset`, `actionMapping` (idle/walk/interact/run).
  - Factory: `createDefaultEntity(type)` returns type-specific defaults.
  - `generateId(prefix)` – timestamp-based unique IDs.
- **scene.ts**: `RoomData` (outline `Vec2[]`, entities, spawnPoints, ambientColor, walkPadding), `DoorDef` (two-point line segment, adjacent room IDs), `WorldProject` (version, projectId, rooms, doors, activeRoomId).

### Serialization (`export/SceneSerializer.ts`)
- `serialize()` / `deserialize()` – JSON with schema version 1.0.0.
- `saveToStorage()` – writes to localStorage **and** POSTs to `/api/save-world` (Vite plugin writes engine's `world.json`).
- `loadFromStorage()` / `importFromFile()` / `downloadJSON()`.

### UI Panels (`ui/`)
All panels are self-contained classes; data flows through EditorApp callbacks.

| Panel | File | Purpose |
|---|---|---|
| **MenuBar** | `MenuBar.ts` | Logo, New/Save/Load/Export buttons, room name badge |
| **TopPanel** | `TopPanel.ts` | Mode switcher (Room / Height / World) with SVG icons |
| **LeftPanel** | `LeftPanel.ts` | Tool buttons (select/translate/rotate/scale/room/door) with keyboard shortcuts (Q/W/E/R/A/D); paint & terrain stubs |
| **RightPanel** | `RightPanel.ts` | Property inspector: entity metadata, type-specific fields, Vec3 grids, color pickers, collapsible sections, delete button |
| **BottomPanel** | `BottomPanel.ts` | Content browser tabs (Assets / Primitives / Functional); draggable cards; async asset fetching from `/api/assets`; dynamic population of textures/sprites/audio with type tags |

### Viewport (`viewport/`)
- **ViewportManager**: Scene, dual camera (perspective + ortho), WebGLRenderer (shadows, AA), OrbitControls, `screenToFloor()` for world map clicks.
- **EditorGrid**: 1-unit main grid + 0.25 sub-grid + RGB axis helpers + transparent floor plane.
- **EntityFactory**: Converts `EditorEntity` → `THREE.Object3D` visual representations (sprites=planes with wireframe, primitives=geometry+material, camera=body+lens+FOV cone, light=orb+rays+range ring, trigger=wireframe box, etc). Tags meshes with `userData.entityId`.
- **GizmoController**: Three.js TransformControls wrapper (translate/rotate/scale); size 0.75; toggles orbit controls during drag.
- **SelectionManager**: Raycaster picking + blue BoxHelper highlight. Fires selection change callbacks.
- **WorldMapController**: 2D vector drawing for room outlines and door segments. Vertex dragging with grid snapping (0.5 units) and wall-edge snapping (threshold 2.0). Room tool = click vertices to close polygon; Door tool = two-click line with auto room-adjacency detection.

### CSS Theme (`ui/styles/editor.css`)
- GitHub Dark–inspired color scheme via CSS custom properties.
- Dark slate backgrounds (`#0d1117` base), blue accent (`#58a6ff`), cyan logo.
- CSS Grid layout: 4 rows (menu/top/body/bottom), 3-column body (left/viewport/right).
- Glass-morph overlay badges, smooth 120ms transitions, custom thin scrollbars.
- Font: Inter (UI), JetBrains Mono (code/IDs).

---

## Editor → Engine Data Flow

```
EditorApp.world (WorldProject)
  → SceneSerializer.serialize() → JSON (schema v1.0.0)
  → POST /api/save-world  (Vite plugin writes engine/src/data/world.json)
  → Engine fetches world.json at startup
  → main.ts maps WorldProject → RoomData[]
  → Engine.registerRooms() + Engine.start()
```

- **Sprites**: `entity.textureSource` → `/assets/textures/{name}.jpg`
- **Audio**: `entity.audioSource` → `/assets/audio/{name}`
- **Rooms**: outline (Vec2[]) defines floor ShapeGeometry + walls + NavGrid bounds.
- **Doors**: Vec2 line segments in WorldProject.doors → engine Portal volumes.
- **Spawn Points**: derived from SpawnEntity → engine player spawn positions.

---

## Asset Structure (`assets/`)

```
assets/
  audio/       – sound files
  data/
    dialogues/ – dialogue JSON files
    maps/      – legacy/auxiliary map data
  models/      – 3D models (future)
  sprites/     – sprite sheets + metadata JSON
  textures/    – environment textures (jpg)
```

The Vite plugin in the editor serves `/api/assets` by scanning `sprites/` and `textures/` for available files. Animated sprites are detected by the presence of a `.json` sidecar file next to the texture.

---

## Shared Core (`tools/shared_core/`)
Currently empty (`ui_components/` and `utils/` have no files). Reserved for future shared libraries between editor and other tools.

---

## Style & Convention Guidelines

### TypeScript
- **Strict mode** everywhere (`strict: true`, `noImplicitAny`, etc.).
- **ES2020** target with ESNext modules.
- `allowImportingTsExtensions: true` in engine (Vite-only, no `.js` emit).
- Use **barrel exports** (`index.ts`) for module directories (e.g., `errors/index.ts`).
- Custom errors extend `GameError` base class; use `new.target.name` for `this.name`; preserve prototype chain with `Object.setPrototypeOf`.

### ECS Conventions
- Components are **plain data objects** matching `ComponentRegistry` types – no methods or logic.
- Tag/marker components use `_tag: true` boolean.
- `Transform.position` represents **feet position** (bottom-center) for sprites.
- Systems receive `World` in constructor; implement `update(dt)`.

### Naming
- PascalCase for classes, types, interfaces, enums.
- camelCase for variables, functions, properties.
- Entity IDs generated with `generateId(prefix)` (timestamp-based).
- File names match class names (e.g., `RoomManager.ts` → `class RoomManager`).

### Editor Data
- All rotation values stored in **degrees** inside the editor; converted to **radians** when passed to Three.js or the engine.
- `Vec3 { x, y, z }` plain objects for JSON serialization (not `THREE.Vector3`).
- Entity and mesh maps are kept in sync but separate (`entityMap` for data, `meshMap` for visuals).

### Rendering
- **Nearest-neighbor filtering** on all game textures – no smoothing.
- No mipmaps.
- SRGB colorspace for gamma-correct rendering.
- Image-rendering CSS: `pixelated`, `crisp-edges`.

### Navigation
- World-space is XZ-horizontal, Y-up.
- NavGrid cell size = 0.5 units; `walkPadding` insets from walls.
- A* with 8-direction movement and corner-cutting prevention.
