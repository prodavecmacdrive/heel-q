# Heel Quest — Global State Registry

Single source of truth for all game objects, ECS components, entity types, and their access/intersection points across the engine, map editor, and future tools.

**Maintained by:** `global-state-synchronizer` skill  
**Last updated:** 2026-04-17

---

## AtlasAnimation

**Category:** ECS Component  
**Status:** Active

### State Structure
| Property | Type | Default | Description |
|---|---|---|---|
| frames | `{x,y,w,h}[]` | `[]` | Pixel-coordinate frames from Texture Packer JSON |
| imageWidth | number | — | Full atlas image width (px) |
| imageHeight | number | — | Full atlas image height (px) |
| currentFrame | number | 0 | Index into `frames[]` |
| frameRate | number | 12 | Frames per second |
| timeAccumulator | number | 0 | Elapsed time since last frame advance |
| loop | boolean | true | Whether to loop when end is reached |
| autoplay | boolean | true | Whether to advance frames automatically |

### Access Points
| Layer | File | Operation | Notes |
|---|---|---|---|
| ECS component | `engine/src/engine/ecs/Component.ts` | Define | Interface + `ComponentRegistry['AtlasAnimation']` |
| Engine spawner | `engine/src/engine/rooms/RoomManager.ts` | Write | Added in `spawnAtlasSpriteEntity()`, `spawnPrimitiveEntity()`, `spawnDoorEntity3D()` |
| Engine system | `engine/src/engine/systems/AnimationSystem.ts` | Read/Tick | Queries `['AtlasAnimation','MeshRenderer']`; updates UV offset per frame |
| Editor type | N/A | — | Not directly represented; derived from parsed sequence JSON |
| Editor UI | N/A | — | Not surfaced; editor shows raw source/json path fields instead |
| Engine mapper | `engine/src/main.ts` | Write | `atlasFrames`, `imageWidth`, `imageHeight` populated during preload from JSON |
| Engine data | `engine/src/engine/rooms/RoomData.ts` | Read | `EntitySpawnDef.atlasFrames`, `.imageWidth`, `.imageHeight` |

### Intersection Points ⚠️
- `EntitySpawnDef.atlasFrames` is populated by `main.ts` preload; must exist before `RoomManager.loadRoom()` is called
- If `AtlasAnimation.frameRate` changes type or name, `AnimationSystem.ts` must be updated simultaneously

---

## SpriteAnimation

**Category:** ECS Component  
**Status:** Active

### State Structure
| Property | Type | Default | Description |
|---|---|---|---|
| columns | number | — | Sprite sheet column count |
| rows | number | — | Sprite sheet row count |
| totalFrames | number | — | Total frame count |
| currentFrame | number | 0 | Current frame index |
| frameRate | number | 6 | Frames per second |
| timeAccumulator | number | 0 | Elapsed time since last frame |
| state | `'idle'\|'walk'` | `'idle'` | Current animation state |
| stateFrames | `Record<string, {start,end}>` | — | Frame ranges per state name |

### Access Points
| Layer | File | Operation | Notes |
|---|---|---|---|
| ECS component | `engine/src/engine/ecs/Component.ts` | Define | Interface + `ComponentRegistry['SpriteAnimation']` |
| Engine spawner | `engine/src/engine/rooms/RoomManager.ts` | Write | Added in `spawnSpriteEntity()` when `SHEET_META` or `sheetColumns`/`sheetRows` is present |
| Engine system | `engine/src/engine/systems/AnimationSystem.ts` | Read/Tick | Queries `['SpriteAnimation','MeshRenderer']`; updates UV repeat/offset |
| Engine system | `engine/src/engine/systems/MovementSystem.ts` | Write | Sets `anim.state = player.isMoving ? 'walk' : 'idle'` |
| Engine mapper | `engine/src/main.ts` | Write | `sheetColumns`, `sheetRows`, `fps` from `animated_sprite` entity |
| Engine data | `engine/src/engine/rooms/RoomData.ts` | Read | `EntitySpawnDef.sheetColumns`, `.sheetRows`, `.fps` |
| Editor type | N/A | — | Uniform-grid sheets only for legacy characters; no editor field yet |

### Intersection Points ⚠️
- `state` is written by `MovementSystem` but only if the entity has a `Player` component — NPC characters need a different state driver
- `SHEET_META` in `RoomManager.ts` hardcodes column/row layout for known sprite keys; adding a new sheet requires updating that map

---

## SpawnEntity / Player Spawn

**Category:** Entity Type (Editor) + Player Component (Engine)  
**Status:** Active

### State Structure (Editor — `SpawnEntity`)
| Property | Type | Default | Description |
|---|---|---|---|
| spawnId | string | `'spawn_default'` | ID used to target this spawn point from doors |
| initialFacing | Vec3 | `{0,0,-1}` | Direction the character faces on spawn |
| characterSpeed | number | 3.0 | Player movement speed (world units/sec) |
| characterAsset | string | `''` | Legacy: sprite sheet key or texture path |
| characterSequenceSource | string | `''` | Atlas image path (e.g. `sprites/player.png`) |
| characterSequenceJson | string | `''` | Texture Packer JSON path (e.g. `sprites/player.json`) |
| characterSequenceFps | number | 12 | Playback FPS for character sequence |
| characterSequenceLoop | boolean | true | Whether animation loops |
| characterSequenceAutoplay | boolean | true | Whether animation autoplays |
| actionMapping.idle | string | `'idle'` | Sequence state name for idle |
| actionMapping.walk | string | `'walk'` | Sequence state name for walk |
| actionMapping.interact | string | `'interact'` | Sequence state name for interact |
| actionMapping.run | string | `'run'` | Sequence state name for run |
| characterCastShadow | boolean | false | Whether player mesh casts shadows |
| characterReceiveShadow | boolean | false | Whether player mesh receives shadows |

### State Structure (Engine — `Player` component)
| Property | Type | Description |
|---|---|---|
| path | `THREE.Vector3[]` | A* waypoint queue |
| speed | number | Movement speed |
| isMoving | boolean | Whether currently moving |
| floorY | number | Y coordinate of room floor |
| pendingPortalId | `string\|null` | Portal to trigger on arrival |

### Access Points
| Layer | File | Operation | Notes |
|---|---|---|---|
| Editor type | `tools/map_editor/src/types/entities.ts` | Define | `SpawnEntity` interface + `createDefaultEntity('spawn')` |
| Editor UI | `tools/map_editor/src/ui/RightPanel.ts` | Read/Write | `renderSpawnProps()` — Character section |
| Editor sync | `tools/map_editor/src/EditorApp.ts` | Read | `syncSpawnPoints()` extracts position into `room.spawnPoints[]` |
| Engine mapper | `engine/src/main.ts` | Read/Transform | `extractSpawnCharacter()` + preload player atlas JSON |
| Engine data | `engine/src/engine/rooms/RoomData.ts` | Read | `RoomData.characterSequenceSource/Json/Fps/Loop/Autoplay/Frames` |
| Engine spawner | `engine/src/engine/rooms/RoomManager.ts` | Write | `spawnAtlasSpriteEntity(…, isPlayer=true)` or `spawnSpriteEntity(…, isPlayer=true)` |
| ECS component | `engine/src/engine/ecs/Component.ts` | Define | `Player` interface + `ComponentRegistry['Player']` |
| Engine system | `engine/src/engine/systems/MovementSystem.ts` | Read/Write | Follows path, sets `isMoving`, drives `SpriteAnimation.state` |
| Engine system | `engine/src/engine/systems/InputSystem.ts` | Write | Sets `player.path` on floor click; `player.pendingPortalId` on door click |
| Engine system | `engine/src/engine/systems/PortalSystem.ts` | Read | Detects portal arrival, triggers room transition |

### Intersection Points ⚠️
- `SpawnEntity.characterSequenceJson` (editor) ↔ `RoomData.characterSequenceJson` (engine) — names must match in `main.ts` extractor
- `SpawnEntity.characterSpeed` ↔ `Player.speed` — passed through `extractSpawnCharacter()` → `RoomManager`
- `syncSpawnPoints()` only extracts `position` and `spawnId` — the character sequence fields are NOT in `spawnPoints[]`; they live on the room-level fields set by `extractSpawnCharacter()`
- If a sequence player is spawned, `Player` component is added inside `spawnAtlasSpriteEntity()`; forgetting `isPlayer=true` breaks all movement
- `characterCastShadow` / `characterReceiveShadow` flow through `extractSpawnCharacter()` → `RoomData` → `EntitySpawnDef.castShadow/receiveShadow` → `mesh.castShadow/receiveShadow`

---

## PrimitiveEntity

**Category:** Entity Type  
**Status:** Active

### State Structure
| Property | Type | Default | Description |
|---|---|---|---|
| geometryType | `'cube'\|'sphere'\|'plane'\|'cylinder'\|'cone'` | `'cube'` | Mesh shape |
| materialType | `'color'\|'textured'\|'sequence'\|'invisible'` | `'color'` | How material is created |
| color | string | `'#808080'` | Hex color |
| opacity | number | 0.5 | Material opacity |
| isCollider | boolean | true | Whether to stamp obstacle on NavGrid |
| textureSource | string | `''` | Path to static texture |
| uvTilingX/Y | number | 1 | UV repeat |
| uvOffsetX/Y | number | 0 | UV offset |
| sequenceSource | string | `''` | Atlas image path |
| sequenceJson | string | `''` | Texture Packer JSON path |
| playbackSpeed | number | 1 | FPS multiplier |
| sequenceLoop | boolean | true | Loop sequence |
| sequenceAutoplay | boolean | true | Autoplay sequence |
| castShadows | boolean | false | Whether mesh casts shadows |
| receiveShadows | boolean | true | Whether mesh receives shadows |

### Access Points
| Layer | File | Operation | Notes |
|---|---|---|---|
| Editor type | `tools/map_editor/src/types/entities.ts` | Define | `PrimitiveEntity` interface |
| Editor UI | `tools/map_editor/src/ui/RightPanel.ts` | Read/Write | `renderPrimitiveProps()` |
| Editor viewport | `tools/map_editor/src/viewport/EntityFactory.ts` | Read | `createPrimitive()` — renders preview mesh with texture |
| Engine mapper | `engine/src/main.ts` | Read/Transform | Maps `e.type === 'primitive'`; normalizes paths |
| Engine data | `engine/src/engine/rooms/RoomData.ts` | Read | `EntitySpawnDef` fields |
| Engine spawner | `engine/src/engine/rooms/RoomManager.ts` | Write | `spawnPrimitiveEntity()` — creates mesh + optional `AtlasAnimation` |

### Intersection Points ⚠️
- `sequenceSource` / `sequenceJson` saved by editor as full Windows paths → normalized by `normalizeAssetPath()` in `main.ts`
- `materialType === 'sequence'` in editor ↔ presence of `atlasFrames` in engine; no explicit `materialType` field flows to engine
- Adding a new `materialType` value requires updating: `entities.ts` type union, `RightPanel.ts` select options, `EntityFactory.ts` preview, and `RoomManager.ts` spawn logic
- Shadow: `castShadows`/`receiveShadows` (editor, plural) → `castShadow`/`receiveShadow` (engine, singular) via `main.ts` mapper

---

## DoorEntity

**Category:** Entity Type  
**Status:** Active

### State Structure
| Property | Type | Default | Description |
|---|---|---|---|
| targetRoomId | string | `''` | Room to transition to |
| targetSpawnId | string | `''` | Spawn point in target room |
| interactionState | `'open'\|'closed'\|'locked'` | `'open'` | Initial door state |
| materialType | `'color'\|'textured'\|'sequence'` | `'color'` | Material mode |
| color | string | `'#6B4423'` | Door color |
| opacity | number | 1 | Opacity |
| textureSource | string | `''` | Static texture path |
| sequenceSource | string | `''` | Atlas image path |
| sequenceJson | string | `''` | Texture Packer JSON path |
| worldDoorId | string | `''` | Links to `WorldProject.doors[].id` for portal matching |
| castShadow | boolean | false | Whether door mesh casts shadows |
| receiveShadow | boolean | true | Whether door mesh receives shadows |

### Access Points
| Layer | File | Operation | Notes |
|---|---|---|---|
| Editor type | `tools/map_editor/src/types/entities.ts` | Define | `DoorEntity` interface |
| Editor UI | `tools/map_editor/src/ui/RightPanel.ts` | Read/Write | `renderDoorProps()` |
| Editor viewport | `tools/map_editor/src/viewport/EntityFactory.ts` | Read | `createDoorHelper()` |
| Engine mapper | `engine/src/main.ts` | Read/Transform | Maps `e.type === 'door'`; normalizes paths; sets `portalId = e.worldDoorId` |
| Engine data | `engine/src/engine/rooms/RoomData.ts` | Read | `EntitySpawnDef` fields |
| Engine spawner | `engine/src/engine/rooms/RoomManager.ts` | Write | `spawnDoorEntity3D()` — mesh + `DoorMarker` + optional `AtlasAnimation` |
| ECS component | `engine/src/engine/ecs/Component.ts` | Define | `DoorMarker` interface |
| Engine system | `engine/src/engine/systems/InputSystem.ts` | Read | Clicks on `DoorMarker` entities set `player.pendingPortalId` |
| Engine system | `engine/src/engine/systems/PortalSystem.ts` | Read | Matches `pendingPortalId` → `PortalDef` → loads next room |

### Intersection Points ⚠️
- `DoorEntity.worldDoorId` ↔ `DoorMarker.portalId` — the engine matches portal triggers using this value; must not be empty
- `DoorEntity.interactionState` ↔ `DoorMarker.interactionState` — currently stored but not yet driving open/close behavior at runtime
- Path normalization applies to `textureSource`, `sequenceSource`, `sequenceJson` — same as PrimitiveEntity
- Shadow: `castShadow`/`receiveShadow` (same name in editor and engine) mapped through `main.ts`

---

## Transform

**Category:** ECS Component  
**Status:** Active

### State Structure
| Property | Type | Description |
|---|---|---|
| position | `THREE.Vector3` | **Feet position** (bottom-center) for sprites; center for primitives |
| rotation | `THREE.Euler` | Object rotation (radians) |
| scale | `THREE.Vector3` | Object scale |

### Access Points
| Layer | File | Operation | Notes |
|---|---|---|---|
| ECS component | `engine/src/engine/ecs/Component.ts` | Define | `Transform` interface |
| Engine spawner | `engine/src/engine/rooms/RoomManager.ts` | Write | Every `spawnXxx()` adds a `Transform` |
| Engine systems | Multiple | Read | `MovementSystem`, `SpriteSystem`, `PixelSnapSystem`, `CameraSystem` |
| Editor | `tools/map_editor/src/types/entities.ts` | Define | `BaseEntity.transform` with `position/rotation/scale` as plain `Vec3` |

### Intersection Points ⚠️
- Editor stores transform in **degrees** (for rotation); engine and Three.js use **radians** — `main.ts` converts for camera entities; `RoomManager.ts` converts for door entities
- Editor `Vec3` ({x,y,z} plain object) ↔ engine `THREE.Vector3` / `THREE.Euler` — the mapper in `main.ts` passes plain objects; `RoomManager` calls `.set()` or `new THREE.Vector3(...)`
