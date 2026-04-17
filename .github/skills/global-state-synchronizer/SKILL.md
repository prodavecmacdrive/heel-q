---
name: global-state-synchronizer
description: "Global State Synchronizer for Heel Quest. Use when adding, renaming, removing, or modifying any game object, ECS component, entity type, or entity property. Maintains 'game-global-state.md' as the single source of truth. Triggers: new component, new entity type, property changed, entity removed, editor field added, spawn logic changed, serializer updated."
argument-hint: "Describe what changed: e.g. 'Added AtlasAnimation component' or 'SpawnEntity gained characterSequenceJson field'"
---

# Global State Synchronizer

## Purpose
Maintain `.github/game-global-state.md` as the single source of truth for all game objects, ECS components, entity types, and their access/intersection points across the entire Heel Quest project.

## When to Use
Invoke this skill whenever ANY of the following happen:
- A new ECS component is added or removed (`engine/src/engine/ecs/Component.ts`)
- A new entity type is added or changed (`tools/map_editor/src/types/entities.ts`)
- Entity properties are added, renamed, or removed in the editor type system
- `EntitySpawnDef` or `RoomData` gains/loses fields (`engine/src/engine/rooms/RoomData.ts`)
- The `main.ts` entity mapper adds/changes/removes field mappings
- `RoomManager.ts` spawn logic gains/loses component wiring
- `RightPanel.ts` adds/removes inspector fields for an entity type
- A new tool/system is added that reads or writes game objects

---

## Procedure

### Step 1 — Identify what changed
Determine the scope of the change from the conversation or code diff:
- Which object/component/entity type changed?
- Was it added, modified, or removed?
- Which files were affected?

### Step 2 — Audit the 5 data layers
For every changed object, check all 5 layers below and note which contain the object:

| Layer | File | What to look for |
|---|---|---|
| **Editor type** | `tools/map_editor/src/types/entities.ts` | Interface fields, `createDefaultEntity()` defaults |
| **Editor UI** | `tools/map_editor/src/ui/RightPanel.ts` | Inspector section and input bindings |
| **Engine mapper** | `engine/src/main.ts` | Property extraction and normalization in the `mappedRooms` block |
| **Engine data** | `engine/src/engine/rooms/RoomData.ts` | `EntitySpawnDef` fields, `RoomData` fields |
| **Engine spawner** | `engine/src/engine/rooms/RoomManager.ts` | Component wiring in `spawnXxx()` methods |
| **ECS component** | `engine/src/engine/ecs/Component.ts` | Interface definition and `ComponentRegistry` entry |

### Step 3 — Update `game-global-state.md`
Open `.github/game-global-state.md` and apply updates using the schema below.

#### Schema for each entry
```markdown
## <ObjectName>

**Category:** ECS Component | Entity Type | Room Property | System  
**Status:** Active | Deprecated

### State Structure
| Property | Type | Default | Description |
|---|---|---|---|
| propName | string | '' | What this stores |

### Access Points
| Layer | File | Operation | Notes |
|---|---|---|---|
| Editor type | `tools/map_editor/src/types/entities.ts` | Define/Read | Interface `XxxEntity` |
| Editor UI | `tools/map_editor/src/ui/RightPanel.ts` | Read/Write | Inspector field binding |
| Engine mapper | `engine/src/main.ts` | Read/Transform | `normalizeAssetPath()` + result mapping |
| Engine data | `engine/src/engine/rooms/RoomData.ts` | Define/Read | `EntitySpawnDef.xxx` |
| Engine spawner | `engine/src/engine/rooms/RoomManager.ts` | Read/Apply | `spawnXxx()` wires component |
| ECS component | `engine/src/engine/ecs/Component.ts` | Define | Interface + registry entry |

### Intersection Points ⚠️
List any fields shared between the editor and engine that must be kept in sync:
- `editor:SpawnEntity.characterSequenceJson` ↔ `engine:RoomData.characterSequenceJson` — both must match field name and normalization logic
- If a field is renamed on one side, the mapper in `main.ts` must be updated simultaneously
```

### Step 4 — Flag intersection risks
After updating the file, explicitly call out any **cross-boundary sync risks**:
- Fields that exist in the editor type AND in `EntitySpawnDef`/`RoomData`
- Fields normalized by `normalizeAssetPath()` — editor saves raw paths, engine normalizes
- Fields that drive both UI rendering (editor) and component creation (engine)

### Step 5 — Prompt for follow-up
After updating `game-global-state.md`, always ask:
> "Are there any other tools (NPC Brain Prebuilder, dialogue system, etc.) that access this object? If so, I'll add them as access points."

---

## Key Architecture Facts (always keep in mind)

### The 5-layer pipeline
Editor fields travel through exactly these 5 hops before becoming live in the engine:
```
Editor Type (entities.ts)
  → Editor UI (RightPanel.ts) — inspector binds and saves
  → world.json — serialized by SceneSerializer
  → main.ts mapper — extracted, normalized (path, type cast)
  → RoomData / EntitySpawnDef — engine-side struct
  → RoomManager.spawnXxx() — wires ECS components
```
Any new field must be present at EVERY hop or it will silently be undefined.

### Path normalization rule
The editor stores asset paths as full Windows paths (e.g. `\assets\sprites\foo.png`).
`main.ts` normalizes these using `normalizeAssetPath()` which:
1. Replaces backslashes with forward slashes
2. Strips leading slashes
3. Strips the `assets/` prefix
Result: `sprites/foo.png` — ready to prefix with `/assets/`.

### ECS component wiring rule
A component only ticks if:
1. Its interface is defined in `Component.ts`
2. It is registered in `ComponentRegistry`
3. It is added via `world.addComponent()` in the correct `spawnXxx()` method
4. The system that processes it queries for it via `world.queryEntities([...])`

### Editor ↔ Engine shared field naming
Fields on `SpawnEntity`, `PrimitiveEntity`, `DoorEntity` in the editor often share names with `EntitySpawnDef` in the engine. When renaming:
- Change `entities.ts` (editor type)
- Change `RightPanel.ts` (UI binding key)
- Change `main.ts` mapper (`e.fieldName`)
- Change `RoomData.ts` (`EntitySpawnDef.fieldName`)
- Change `RoomManager.ts` (`def.fieldName`)

---

## `game-global-state.md` Maintenance Rules
1. Every entry must have **all 5 layers** listed, even if a layer says "N/A".
2. Intersection points must be listed whenever a field name crosses the editor/engine boundary.
3. When a field is removed, mark it **Deprecated** before deleting the entry (one commit grace period).
4. The file is append-friendly — add new entries at the bottom; do not reorganize existing ones unless specifically asked.
