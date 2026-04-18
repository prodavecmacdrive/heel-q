# Tech Debt & Recommendations — Heel Quest

> Compiled from codebase analysis of `prodavecmacdrive/heel-q`.  
> Status legend: `[ ]` open · `[~]` in progress · `[x]` done

---

## P0 — Critical (fix before adding new features)

### 1. Create the shared type package

**Problem:** `WorldProject`, `RoomData`, `DoorDef`, and `EditorEntity` are defined only in
`tools/map_editor/src/types/`. The engine's `main.ts` maps the same data using `(r: any)`,
`(e: any)`, `(cam: any)` casts. The folder `tools/shared_core/` already exists but is empty.
Any schema change can silently break the engine at runtime with zero TypeScript errors.

**Tasks:**
- [x] Move `tools/map_editor/src/types/entities.ts` and `scene.ts` into `tools/shared_core/src/types/`
- [x] Register `shared_core` as a local workspace package in the root `package.json`
- [x] Add `shared_core` as a dependency in both `engine/package.json` and `tools/map_editor/package.json`
- [x] Replace all `(r: any)` / `(e: any)` / `(cam: any)` casts in `engine/src/main.ts` with imports from `shared_core`
- [ ] Verify `tsc --noEmit` passes in both packages after the migration

---

### 2. Extract WorldLoader from `main.ts`

**Problem:** `engine/src/main.ts` contains ~400 lines that mix engine bootstrap with
`world.json → internal RoomData` mapping logic. Any schema change requires editing the startup
file. This will only get worse as the world schema grows.

**Tasks:**
- [x] Create `engine/src/loaders/WorldLoader.ts` with a single responsibility: parse a `WorldProject` and return typed `RoomData[]`
- [x] Move all mapping logic (entity parsing, camera parsing, door parsing, asset path normalization) out of `main.ts` into `WorldLoader`
- [x] In `main.ts`, replace the inline mapping block with a single `WorldLoader.load(rawJson)` call
- [x] Ensure `WorldLoader` uses the shared types from `shared_core` (see task 1)

---

### 3. Fix `_flightMouseHandler` in `EditorApp`

**Problem:** `EditorApp` stores the pointer-lock mouse handler as `(this as any)._flightMouseHandler`
because it is not declared as a class property. If `exitFlightMode()` is called before
`enterFlightMode()` completes, the handler reference is lost and the listener remains attached
permanently — a memory leak and a functional bug.

**Tasks:**
- [x] Declare `private _flightMouseHandler: ((e: MouseEvent) => void) | null = null` as a proper class field
- [x] Replace all `(this as any)._flightMouseHandler` references with the typed field
- [ ] Verify that rapid enter/exit of flight mode does not leave orphaned listeners (manual test)

---

## P1 — Important (do before content production begins)

### 4. Remove `activeRoomId` from the exported world schema

**Problem:** `WorldProject.activeRoomId` is an internal editor cursor. It gets written to
`world.json` and loaded by the engine, where it carries no meaning. Editor state should not
leak into the runtime data contract.

**Tasks:**
- [x] Remove `activeRoomId` from the `WorldProject` interface in `shared_core` (or mark it `editorOnly`)
- [x] Update `SceneSerializer.ts` to strip `activeRoomId` before POSTing to `/api/save-world`
- [~] Keep `activeRoomId` as a local field inside `EditorApp` state only (kept in WorldProject as optional for localStorage persistence)

---

### 5. Add `world.json` to `.gitignore`

**Problem:** `engine/src/data/world.json` is an auto-generated file written by the editor on
every save. It is not currently excluded from git, which means every map edit is a potential
commit and a source of constant merge conflicts in any team workflow.

**Tasks:**
- [x] Add `engine/src/data/world.json` to `.gitignore`
- [x] Create `engine/src/data/world.example.json` with a minimal valid `WorldProject` as a starting template
- [x] Document the example file in the README under "How to Run"

---

### 6. Clarify `localStorage` vs. file as source of truth in the editor

**Problem:** The editor persists state to both `localStorage` (auto-save) and to
`engine/src/data/world.json` via POST. If the POST fails silently (network error, engine server
down), the two stores diverge with no user feedback about which one is current.

**Tasks:**
- [x] Show a persistent status indicator in the editor UI: last successful save timestamp + destination (`localStorage` vs. engine file)
- [ ] On startup, if `localStorage` is newer than the last known POST, prompt the user to decide which version to load
- [x] Document the intended priority rule in a code comment in `SceneSerializer.ts`

---

### 7. Export `CELL_SIZE` from `NavGrid`

**Problem:** `const CELL_SIZE = 0.5` is a module-level constant in `NavGrid.ts` and is not
exported. Any system that needs to reason about navigation grid units must re-derive or
hardcode the same value independently.

**Tasks:**
- [x] Export `CELL_SIZE` from `NavGrid.ts`
- [ ] Audit all files for inline `0.5` values used in a navigation context and replace them with the import
- [ ] Consider moving it to `engine/src/engine/constants.ts` alongside `VIRTUAL_WIDTH/HEIGHT` and `PIXEL_RATIO`

---

### 8. Move `SHEET_META` to data files

**Problem:** Sprite-sheet layout definitions for `elias_sheet`, `vance_sheet`, `dog_sheet`, and
`scifi_sheet` are hardcoded as a `SHEET_META` constant in `RoomManager.ts`. Adding a new
character sprite sheet requires editing engine source code rather than dropping a data file.

**Tasks:**
- [x] Define a `SpriteSheetMeta` interface (frame dimensions, row count, column count, animation map)
- [x] Move each entry in `SHEET_META` to a sidecar JSON file next to the sprite sheet in `assets/sprites/`
- [x] Update `TextureManager` or `RoomManager` to read sheet metadata from the JSON sidecar at load time
- [ ] Verify `PlaceholderGenerator` still works after the refactor (it may reference `SHEET_META` directly)

---

## P2 — Before starting the Event-Trigger editor

### 9. Lock down the `trigger` entity schema

**Problem:** The `trigger` discriminant exists in the `EditorEntity` union, but its fields have
not been fully specified. Building a visual Event-Trigger editor on top of an incomplete type
means refactoring both the editor and the schema at the same time later.

**Tasks:**
- [x] Design and document the full `TriggerEntity` interface: condition type, event type, target entity ids, optional payload
- [x] Add the finalized `TriggerEntity` to `shared_core` types
- [x] Update the editor's `RightPanel` property inspector to render all trigger fields
- [x] Update the engine's mapper in `WorldLoader` (see task 2) to parse trigger entities into an internal representation

---

## P3 — Low priority / housekeeping

### 10. Name the `DepthSortSystem` scale factor

**Problem:** `renderOrder = round(feetZ × 1000)` — the `1000` multiplier is undocumented.
It's unclear whether it's related to `PIXEL_RATIO` or is an arbitrary large number.

**Tasks:**
- [x] Add `const DEPTH_SORT_SCALE = 1000` to `constants.ts` with a one-line comment explaining the choice
- [x] Replace the inline literal in `DepthSortSystem.ts`

---

### 11. Name magic numbers in the map editor viewport

**Problem:** Snap grid `0.5` and edge-snap threshold `2.0` are inline magic numbers in
`WorldMapController.ts` mouse-event handlers. Grid size `50` and sub-grid step `0.25` are
hardcoded in `EditorGrid.ts` constructor.

**Tasks:**
- [x] Extract `SNAP_GRID = 0.5`, `EDGE_SNAP_THRESHOLD = 2.0` as named constants at the top of `WorldMapController.ts`
- [x] Extract `GRID_SIZE = 50`, `SUB_GRID_STEP = 0.25` as named constants in `EditorGrid.ts`

---

### 12. Harden asset path normalization in `main.ts`

**Problem:** Windows backslash → forward-slash conversion and `assets/` prefix stripping are
done with raw string `.replace()` at lines ~125–140. This breaks if the editor changes its
path format.

**Tasks:**
- [x] Replace ad-hoc `.replace()` calls with a dedicated `normalizeAssetPath(raw: string): string` utility function
- [x] Add the function to `shared_core` so both the engine and editor use the same normalization logic
- [x] Add a unit test (or at minimum a comment with example inputs/outputs) for the edge cases: Windows paths, leading slash, missing `assets/` prefix

---

### 13. Simplify the install workflow

**Problem:** Installing dependencies requires two separate `cd` + `npm install` commands.

**Tasks:**
- [x] Configure npm workspaces in the root `package.json` so that `npm install` from the repo root installs all packages in one step
- [x] Update the "How to Run" section in `README.md` accordingly

---

This avoids a breaking schema change once the system goes live.

---

*Last updated: 2026-04-18*
