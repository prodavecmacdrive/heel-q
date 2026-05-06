/* ═══════════════════════════════════════════════════════════════════════
   Entity Type System — shared between engine and editor
   ═══════════════════════════════════════════════════════════════════════ */

export type EntityType =
  | 'sprite'
  | 'animated_sprite'
  | 'primitive'
  | 'texture'
  | 'camera'
  | 'light'
  | 'sound'
  | 'trigger'
  | 'spawn'
  | 'door'
  | 'archetype_instance';

// ── Archetype Schema Types ─────────────────────────────────────────────

export type ArchetypePropertyType =
  | 'boolean'
  | 'number'
  | 'string'
  | 'enum'
  | 'asset_select'
  | 'color_hex'
  | 'array_of_ids'
  | 'vec3'
  | 'object';

export type ArchetypeObjectKind = 'nested_archetype';

/** Entity types that can be placed as visual children inside an archetype. */
export type ChildEntityType =
  | 'primitive'
  | 'light'
  | 'sprite'
  | 'animated_sprite'
  | 'sound'
  | 'trigger';

/**
 * A visual child object embedded inside an archetype definition.
 * Each child has a local transform relative to the archetype origin and
 * entity-type-specific properties stored in the `props` bag.
 */
export interface ArchetypeChildDef {
  id: string;
  name: string;
  entityType: ChildEntityType;
  transform: BaseEntity['transform'];
  visible: boolean;
  /** Flat entity-specific fields (e.g. color, geometryType, intensity…) */
  props: Record<string, unknown>;
}

export interface NestedArchetypeValue {
  archetypeId: string;
  transform?: BaseEntity['transform'];
  visible?: boolean;
  layer?: number;
  overrides?: Record<string, unknown>;
}

export interface ArchetypePropertyDef {
  name: string;
  type: ArchetypePropertyType;
  objectKind?: ArchetypeObjectKind;
  default?: unknown;
  options?: string[];
  min?: number;
  max?: number;
  placeholder?: string;
}

export interface ArchetypeSockets {
  inputs: string[];
  outputs: string[];
}

export interface ArchetypeDef {
  category: string;
  description: string;
  /**
   * @deprecated Only present on legacy and `_sys:` archetypes.
   * New user archetypes use `children[]` and have no render type.
   */
  renderType?: string;
  /** Default transform applied when placing a new archetype instance in a room. */
  defaultTransform?: BaseEntity['transform'];
  sockets: ArchetypeSockets;
  properties: ArchetypePropertyDef[];
  defaultVerbs: string[];
  /** Visual child objects that form this archetype's 3-D representation. */
  children: ArchetypeChildDef[];
}

export interface ArchetypeSchema {
  archetypes: Record<string, ArchetypeDef>;
}

export type PrimitiveGeometry = 'cube' | 'sphere' | 'plane' | 'cylinder' | 'cone';
export type LightType = 'point' | 'directional' | 'spot' | 'rect_area';
export type FlickerMode = 'none' | 'pattern' | 'random';
export type BlendMode = 'normal' | 'additive' | 'multiply';
export type BillboardMode = 'fixed' | 'face_camera' | 'y_axis';
export type TriggerShape = 'box' | 'sphere';
export type TriggerCondition = 'always' | 'item_required' | 'flag_set' | 'quest_state';
export type MaterialType = 'invisible' | 'color' | 'textured' | 'sequence';
export type DoorInteractionState = 'open' | 'locked' | 'closed';

/** Vector3 data (plain object for serialization) */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Sprite sheet grid metadata (sidecar .sheet.json format) */
export interface SpriteSheetMeta {
  columns: number;
  rows: number;
  totalFrames: number;
  stateFrames: Record<string, { start: number; end: number }>;
}

// ── Base Entity ────────────────────────────────────────────────────────

/** Properties shared by every entity */
export interface BaseEntity {
  id: string;
  name: string;
  type: EntityType;
  transform: {
    position: Vec3;
    rotation: Vec3;
    scale: Vec3;
  };
  visible: boolean;
  layer: number;
}

// ── Specific Entity Types ──────────────────────────────────────────────

export interface SpriteEntity extends BaseEntity {
  type: 'sprite';
  textureSource: string;
  normalMap: string;
  depthMap: string;
  blendMode: BlendMode;
  castShadows: boolean;
  receiveShadows: boolean;
  billboardMode: BillboardMode;
  isCollider: boolean;
}

export interface AnimatedSpriteEntity extends BaseEntity {
  type: 'animated_sprite';
  textureSource: string;
  normalMap: string;
  depthMap: string;
  blendMode: BlendMode;
  castShadows: boolean;
  receiveShadows: boolean;
  billboardMode: BillboardMode;
  isCollider: boolean;
  framesCount: number;
  columns: number;
  rows: number;
  fps: number;
  loop: boolean;
  autoplay: boolean;
}

export interface PrimitiveEntity extends BaseEntity {
  type: 'primitive';
  geometryType: PrimitiveGeometry;
  materialType: MaterialType;
  color: string;
  isCollider: boolean;
  opacity: number;
  // Static texture params
  textureSource: string;
  uvTilingX: number;
  uvTilingY: number;
  uvOffsetX: number;
  uvOffsetY: number;
  // Sequence (animated texture) params
  sequenceSource: string;      // sprite sheet image path
  sequenceJson: string;        // animation descriptor JSON path
  activeAnimation: string;     // current animation state name
  playbackSpeed: number;
  sequenceLoop: boolean;
  sequenceAutoplay: boolean;
  castShadows: boolean;
  receiveShadows: boolean;
}

export interface TextureEntity extends BaseEntity {
  type: 'texture';
  textureSource: string;
  blendMode: BlendMode;
  opacity: number;
  castShadows: boolean;
  receiveShadows: boolean;
  uvTilingX: number;
  uvTilingY: number;
  uvOffsetX: number;
  uvOffsetY: number;
}

export interface CameraEntity extends BaseEntity {
  type: 'camera';
  fov: number;
  orthoSize: number;
  near: number;
  far: number;
  isDefault: boolean;
  targetLookAt: string; // entity ID or ""
}

export interface LightEntity extends BaseEntity {
  type: 'light';
  lightType: LightType;
  color: string;
  intensity: number;
  distance: number;
  decay: number;
  // Spotlight-specific
  angle: number;         // degrees (0–90)
  penumbra: number;      // 0–1 edge softness
  // Target point for spot / directional
  targetPosition: Vec3;
  // Shadow settings
  castShadows: boolean;
  shadowResolution: number;   // 256 | 512 | 1024 | 2048
  shadowBias: number;
  shadowNormalBias: number;
  shadowRadius: number;
  // Cookie / gobo projected texture
  cookieTexture: string;
  // Flicker
  flickerMode: FlickerMode;
  flickerSpeed: number;
  flickerAmplitude: number;
  // Flicker smoothing: 0 = instant, >0 = smoother transitions (seconds^-1)
  flickerDecay?: number;
  // Binary pattern describing on(1)/off(0) sequence, serialized as JSON string
  flickerPattern?: string;
  // RectArea specific
  rectWidth: number;
  rectHeight: number;
}

export interface SoundEntity extends BaseEntity {
  type: 'sound';
  audioSource: string;
  volume: number;
  loop: boolean;
  spatialAudio: boolean;
  refDistance: number;
  maxDistance: number;
}

export interface TriggerEntity extends BaseEntity {
  type: 'trigger';
  shape: TriggerShape;
  onEnterEvent: string;
  onLeaveEvent: string;
  triggerOnce: boolean;
  /** Extents for the trigger volume */
  extents: Vec3;
  /** Condition that must be met for the trigger to fire */
  conditionType: TriggerCondition;
  /** Value associated with the condition (flag name, item ID, quest identifier) */
  conditionValue: string;
  /** Entity IDs affected by this trigger */
  targetEntityIds: string[];
  /** JSON-serializable payload passed to the event handler */
  payload: string;
}

export interface SpawnEntity extends BaseEntity {
  type: 'spawn';
  spawnId: string;
  initialFacing: Vec3;
  // Character parameters
  characterSpeed: number;
  characterAsset: string;       // path to main sprite sheet/model
  characterSequenceSource: string;
  characterSequenceJson: string;
  characterSequenceFps: number;
  characterSequenceLoop: boolean;
  characterSequenceAutoplay: boolean;
  actionMapping: {              // maps hardcoded states to sequence names
    idle: string;
    walk: string;
    interact: string;
    run: string;
  };
  characterCastShadow: boolean;
  characterReceiveShadow: boolean;
}

export interface DoorEntity extends BaseEntity {
  type: 'door';
  targetRoomId: string;
  targetSpawnId: string;
  interactionState: DoorInteractionState;
  // Inherits all standard primitive material props
  materialType: MaterialType;
  color: string;
  opacity: number;
  textureSource: string;
  uvTilingX: number;
  uvTilingY: number;
  uvOffsetX: number;
  uvOffsetY: number;
  sequenceSource: string;
  sequenceJson: string;
  activeAnimation: string;
  playbackSpeed: number;
  sequenceLoop: boolean;
  sequenceAutoplay: boolean;
  // Wall mounting — set at auto-placement time, kept locked thereafter
  wallDirX: number;    // unit vector X along wall direction
  wallDirZ: number;    // unit vector Z along wall direction
  wallAnchorX: number; // a fixed world-space point on the wall line (used for projection)
  wallAnchorZ: number;
  worldDoorId: string; // ID of the parent door segment in WorldProject.doors
  castShadow: boolean;
  receiveShadow: boolean;
}

export interface ArchetypeInstanceEntity extends BaseEntity {
  type: 'archetype_instance';
  /** Key into ArchetypeSchema.archetypes */
  archetypeId: string;
  /**
   * Only the properties that differ from the archetype's defaults.
   * Base entity props (id, name, transform, visible, layer) are NOT in overrides.
   */
  overrides: Record<string, unknown>;
}

/** Discriminated union of all entity types */
export type EditorEntity =
  | SpriteEntity
  | AnimatedSpriteEntity
  | PrimitiveEntity
  | TextureEntity
  | CameraEntity
  | LightEntity
  | SoundEntity
  | TriggerEntity
  | SpawnEntity
  | DoorEntity
  | ArchetypeInstanceEntity;

type ResolvedArchetypeEntity = (Omit<EditorEntity, 'type'> & { type: string } & Record<string, unknown>);

/**
 * Resolve an archetype instance into a concrete entity by merging archetype
 * property defaults with instance overrides.  Returns null if the archetype
 * is not found in the schema.
 */
export function resolveArchetypeInstance(
  entity: ArchetypeInstanceEntity,
  schema: ArchetypeSchema,
): ResolvedArchetypeEntity | null {
  const archetype = schema.archetypes[entity.archetypeId];
  if (!archetype) return null;

  // Build merged props: archetype defaults → instance overrides
  const merged: Record<string, unknown> = {};
  for (const prop of archetype.properties) {
    merged[prop.name] = prop.default;
  }
  Object.assign(merged, entity.overrides);

  if (!merged.textureSource && typeof merged.texture === 'string') {
    merged.textureSource = merged.texture;
  }
  if (!merged.texture && typeof merged.textureSource === 'string') {
    merged.texture = merged.textureSource;
  }

  return {
    ...entity,
    ...merged,
    type: archetype.renderType,
  } as any;
}

export function createDefaultNestedArchetypeValue(archetypeId: string = ''): NestedArchetypeValue {
  return {
    archetypeId,
    transform: createDefaultTransform(),
    visible: true,
    layer: 0,
    overrides: {},
  };
}

/** Returns default props for a given child entity type. */
function getDefaultChildProps(type: ChildEntityType): Record<string, unknown> {
  switch (type) {
    case 'primitive':
      return { geometryType: 'cube', materialType: 'color', color: '#808080', isCollider: false, opacity: 1, textureSource: '', uvTilingX: 1, uvTilingY: 1, uvOffsetX: 0, uvOffsetY: 0, castShadows: false, receiveShadows: true };
    case 'light':
      return { lightType: 'point', color: '#ffffff', intensity: 1, distance: 10, decay: 2, angle: 45, penumbra: 0, targetPosition: { x: 0, y: 0, z: 0 }, castShadows: false, shadowResolution: 512, shadowBias: 0, shadowNormalBias: 0.15, shadowRadius: 1, cookieTexture: '', flickerMode: 'none', flickerSpeed: 1, flickerAmplitude: 0.1, flickerDecay: 0.5, flickerPattern: '[0,1]', rectWidth: 1, rectHeight: 1 };
    case 'sprite':
      return { textureSource: '', normalMap: '', depthMap: '', blendMode: 'normal', castShadows: false, receiveShadows: false, billboardMode: 'face_camera', isCollider: false };
    case 'animated_sprite':
      return { textureSource: '', normalMap: '', depthMap: '', blendMode: 'normal', castShadows: false, receiveShadows: false, billboardMode: 'face_camera', isCollider: false, framesCount: 1, columns: 1, rows: 1, fps: 12, loop: true, autoplay: true };
    case 'sound':
      return { audioSource: '', volume: 1, loop: true, spatialAudio: true, refDistance: 1, maxDistance: 20 };
    case 'trigger':
      return { shape: 'box', extents: { x: 1, y: 1, z: 1 }, onEnterEvent: '', onLeaveEvent: '', triggerOnce: false, conditionType: 'always', conditionValue: '', targetEntityIds: [], payload: '' };
    default:
      return {};
  }
}

export function createDefaultChildDef(entityType: ChildEntityType, name?: string): ArchetypeChildDef {
  return {
    id: generateId('child'),
    name: name || entityType,
    entityType,
    transform: createDefaultTransform(),
    visible: true,
    props: getDefaultChildProps(entityType),
  };
}

export function isNestedArchetypeValue(value: unknown): value is NestedArchetypeValue {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as NestedArchetypeValue).archetypeId === 'string'
  );
}

export function composeTransforms(
  parent: BaseEntity['transform'],
  child?: BaseEntity['transform'],
): BaseEntity['transform'] {
  const local = child ?? createDefaultTransform();

  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const rotatePoint = (point: Vec3, rotation: Vec3): Vec3 => {
    let x = point.x;
    let y = point.y;
    let z = point.z;

    const rx = toRadians(rotation.x);
    const ry = toRadians(rotation.y);
    const rz = toRadians(rotation.z);

    // X-axis rotation
    let cosX = Math.cos(rx);
    let sinX = Math.sin(rx);
    let y1 = y * cosX - z * sinX;
    let z1 = y * sinX + z * cosX;
    y = y1;
    z = z1;

    // Y-axis rotation
    let cosY = Math.cos(ry);
    let sinY = Math.sin(ry);
    let x1 = x * cosY + z * sinY;
    let z2 = -x * sinY + z * cosY;
    x = x1;
    z = z2;

    // Z-axis rotation
    let cosZ = Math.cos(rz);
    let sinZ = Math.sin(rz);
    let x2 = x * cosZ - y * sinZ;
    let y2 = x * sinZ + y * cosZ;
    x = x2;
    y = y2;

    return { x, y, z };
  };

  const scaledLocalPosition = {
    x: local.position.x * parent.scale.x,
    y: local.position.y * parent.scale.y,
    z: local.position.z * parent.scale.z,
  };

  const rotatedLocalPosition = rotatePoint(scaledLocalPosition, parent.rotation);

  return {
    position: {
      x: parent.position.x + rotatedLocalPosition.x,
      y: parent.position.y + rotatedLocalPosition.y,
      z: parent.position.z + rotatedLocalPosition.z,
    },
    rotation: {
      x: parent.rotation.x + local.rotation.x,
      y: parent.rotation.y + local.rotation.y,
      z: parent.rotation.z + local.rotation.z,
    },
    scale: {
      x: parent.scale.x * local.scale.x,
      y: parent.scale.y * local.scale.y,
      z: parent.scale.z * local.scale.z,
    },
  };
}

export function composePoint(
  parent: BaseEntity['transform'],
  localPoint: Vec3,
): Vec3 {
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const rotatePoint = (point: Vec3, rotation: Vec3): Vec3 => {
    let x = point.x;
    let y = point.y;
    let z = point.z;

    const rx = toRadians(rotation.x);
    const ry = toRadians(rotation.y);
    const rz = toRadians(rotation.z);

    // X-axis rotation
    let cosX = Math.cos(rx);
    let sinX = Math.sin(rx);
    let y1 = y * cosX - z * sinX;
    let z1 = y * sinX + z * cosX;
    y = y1;
    z = z1;

    // Y-axis rotation
    let cosY = Math.cos(ry);
    let sinY = Math.sin(ry);
    let x1 = x * cosY + z * sinY;
    let z2 = -x * sinY + z * cosY;
    x = x1;
    z = z2;

    // Z-axis rotation
    let cosZ = Math.cos(rz);
    let sinZ = Math.sin(rz);
    let x2 = x * cosZ - y * sinZ;
    let y2 = x * sinZ + y * cosZ;
    x = x2;
    y = y2;

    return { x, y, z };
  };

  const scaledPoint = {
    x: localPoint.x * parent.scale.x,
    y: localPoint.y * parent.scale.y,
    z: localPoint.z * parent.scale.z,
  };

  const rotatedPoint = rotatePoint(scaledPoint, parent.rotation);

  return {
    x: parent.position.x + rotatedPoint.x,
    y: parent.position.y + rotatedPoint.y,
    z: parent.position.z + rotatedPoint.z,
  };
}

export function getNestedArchetypeInstances(
  entity: ArchetypeInstanceEntity,
  schema: ArchetypeSchema,
): ArchetypeInstanceEntity[] {
  const archetype = schema.archetypes[entity.archetypeId];
  if (!archetype) return [];

  const nestedInstances: ArchetypeInstanceEntity[] = [];
  for (const prop of archetype.properties) {
    if (prop.type !== 'object' || prop.objectKind !== 'nested_archetype') continue;
    const rawValue = entity.overrides[prop.name] ?? prop.default;
    if (!isNestedArchetypeValue(rawValue) || !rawValue.archetypeId) continue;

    nestedInstances.push({
      id: generateId('nested'),
      name: `${entity.name}:${prop.name}`,
      type: 'archetype_instance',
      archetypeId: rawValue.archetypeId,
      transform: rawValue.transform ? composeTransforms(createDefaultTransform(), rawValue.transform) : createDefaultTransform(),
      visible: rawValue.visible ?? entity.visible,
      layer: rawValue.layer ?? entity.layer,
      overrides: { ...(rawValue.overrides ?? {}) },
    });
  }

  // New-style archetypes may declare `children: ArchetypeChildDef[]` which
  // represent visual child objects that should be spawned when the archetype
  // instance is expanded. Convert each child into a concrete EditorEntity
  // object so the engine's loader will map and spawn them.
  const archAny: any = archetype as any;
  if (Array.isArray(archAny.children) && archAny.children.length > 0) {
    for (const child of archAny.children) {
      // Build a pseudo-entity from the child definition. Child props are
      // spread onto the entity so `mapEntity()` can pick them up.
      const childEntity: any = {
        id: generateId('child'),
        name: `${entity.name}:${child.name}`,
        type: child.entityType,
        transform: child.transform,
        visible: (entity.visible ?? true) && (child.visible ?? true),
        layer: child.layer ?? entity.layer,
        // copy child props into top-level fields
        ...(child.props ?? {}),
      };
      nestedInstances.push(childEntity as any as ArchetypeInstanceEntity);
    }
  }

  return nestedInstances;
}

// ── Factory Defaults ───────────────────────────────────────────────────

let _idCounter = 0;

export function generateId(prefix: string = 'obj'): string {
  return `${prefix}_${Date.now().toString(36)}_${(++_idCounter).toString(36)}`;
}

export function createDefaultTransform(): BaseEntity['transform'] {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale:    { x: 1, y: 1, z: 1 },
  };
}

export function createDefaultEntity(type: EntityType, name?: string): EditorEntity {
  const base: BaseEntity = {
    id: generateId(type),
    name: name || `New ${type}`,
    type,
    transform: createDefaultTransform(),
    visible: true,
    layer: 0,
  };

  switch (type) {
    case 'sprite':
      return { ...base, type: 'sprite', textureSource: '', normalMap: '', depthMap: '', blendMode: 'normal', castShadows: false, receiveShadows: false, billboardMode: 'face_camera', isCollider: false };

    case 'animated_sprite':
      return { ...base, type: 'animated_sprite', textureSource: '', normalMap: '', depthMap: '', blendMode: 'normal', castShadows: false, receiveShadows: false, billboardMode: 'face_camera', isCollider: false, framesCount: 1, columns: 1, rows: 1, fps: 12, loop: true, autoplay: true };

    case 'primitive':
      return { ...base, type: 'primitive', geometryType: 'cube', materialType: 'color', color: '#808080', isCollider: true, opacity: 0.5, textureSource: '', uvTilingX: 1, uvTilingY: 1, uvOffsetX: 0, uvOffsetY: 0, sequenceSource: '', sequenceJson: '', activeAnimation: '', playbackSpeed: 1, sequenceLoop: true, sequenceAutoplay: true, castShadows: false, receiveShadows: true };

    case 'texture':
      return { ...base, type: 'texture', textureSource: '', blendMode: 'normal', opacity: 1, castShadows: false, receiveShadows: true, uvTilingX: 1, uvTilingY: 1, uvOffsetX: 0, uvOffsetY: 0 };

    case 'camera':
      return { ...base, type: 'camera', fov: 45, orthoSize: 10, near: 0.1, far: 100, isDefault: false, targetLookAt: '' };

    case 'light':
      return { ...base, type: 'light', lightType: 'point', color: '#ffffff', intensity: 1, distance: 10, decay: 2, angle: 45, penumbra: 0, targetPosition: { x: 0, y: 0, z: 0 }, castShadows: false, shadowResolution: 1024, shadowBias: 0, shadowNormalBias: 0.15, shadowRadius: 1, cookieTexture: '', flickerMode: 'none', flickerSpeed: 1, flickerAmplitude: 0.1, flickerDecay: 0.5, flickerPattern: '[0,1,0,1]', rectWidth: 1, rectHeight: 1 };

    case 'sound':
      return { ...base, type: 'sound', audioSource: '', volume: 1, loop: true, spatialAudio: true, refDistance: 1, maxDistance: 20 };

    case 'trigger':
      return { ...base, type: 'trigger', shape: 'box', onEnterEvent: '', onLeaveEvent: '', triggerOnce: false, extents: { x: 2, y: 2, z: 2 }, conditionType: 'always', conditionValue: '', targetEntityIds: [], payload: '' };

    case 'spawn':
      return { ...base, type: 'spawn', spawnId: 'spawn_default', initialFacing: { x: 0, y: 0, z: -1 }, characterSpeed: 3.0, characterAsset: '', characterSequenceSource: '', characterSequenceJson: '', characterSequenceFps: 12, characterSequenceLoop: true, characterSequenceAutoplay: true, actionMapping: { idle: 'idle', walk: 'walk', interact: 'interact', run: 'run' }, characterCastShadow: false, characterReceiveShadow: false };

    case 'door':
      return { ...base, type: 'door', name: name || 'New Door', targetRoomId: '', targetSpawnId: '', interactionState: 'open', materialType: 'color', color: '#6B4423', opacity: 1, textureSource: '', uvTilingX: 1, uvTilingY: 1, uvOffsetX: 0, uvOffsetY: 0, sequenceSource: '', sequenceJson: '', activeAnimation: '', playbackSpeed: 1, sequenceLoop: true, sequenceAutoplay: true, wallDirX: 1, wallDirZ: 0, wallAnchorX: 0, wallAnchorZ: 0, worldDoorId: '', castShadow: false, receiveShadow: true, transform: { ...base.transform, scale: { x: 1.2, y: 2.5, z: 0.35 } } };

    case 'archetype_instance':
      return { ...base, type: 'archetype_instance', archetypeId: '', overrides: {} };
  }
}

/**
 * Create a default archetype instance entity for the given archetype.
 * Prefer this factory over createDefaultEntity('archetype_instance') since
 * it correctly sets the archetypeId.
 */
export function createDefaultArchetypeInstance(
  archetypeId: string,
  archetype: ArchetypeDef,
  name?: string,
): ArchetypeInstanceEntity {
  const defaultTransform = archetype.defaultTransform ?? createDefaultTransform();
  return {
    id: generateId('arch'),
    name: name || archetypeId,
    type: 'archetype_instance',
    archetypeId,
    transform: {
      position: { ...defaultTransform.position },
      rotation: { ...defaultTransform.rotation },
      scale: { ...defaultTransform.scale },
    },
    visible: true,
    layer: 0,
    overrides: {},
  };
}
