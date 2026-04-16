/* ═══════════════════════════════════════════════════════════════════════
   Entity Type System — matches spec §3
   ═══════════════════════════════════════════════════════════════════════ */

export type EntityType =
  | 'sprite'
  | 'animated_sprite'
  | 'primitive'
  | 'camera'
  | 'light'
  | 'sound'
  | 'trigger'
  | 'spawn';

export type PrimitiveGeometry = 'cube' | 'sphere' | 'plane' | 'cylinder' | 'cone';
export type LightType = 'point' | 'directional' | 'spot';
export type BlendMode = 'normal' | 'additive' | 'multiply';
export type BillboardMode = 'fixed' | 'face_camera' | 'y_axis';
export type TriggerShape = 'box' | 'sphere';
export type MaterialType = 'invisible' | 'color' | 'textured';

/** Vector3 data (plain object for serialization) */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
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
  castShadows: boolean;
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
}

export interface SpawnEntity extends BaseEntity {
  type: 'spawn';
  spawnId: string;
  initialFacing: Vec3;
}

/** Discriminated union of all entity types */
export type EditorEntity =
  | SpriteEntity
  | AnimatedSpriteEntity
  | PrimitiveEntity
  | CameraEntity
  | LightEntity
  | SoundEntity
  | TriggerEntity
  | SpawnEntity;

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
      return { ...base, type: 'sprite', textureSource: '', normalMap: '', depthMap: '', blendMode: 'normal', castShadows: false, receiveShadows: false, billboardMode: 'fixed' };

    case 'animated_sprite':
      return { ...base, type: 'animated_sprite', textureSource: '', normalMap: '', depthMap: '', blendMode: 'normal', castShadows: false, receiveShadows: false, billboardMode: 'fixed', framesCount: 1, columns: 1, rows: 1, fps: 12, loop: true, autoplay: true };

    case 'primitive':
      return { ...base, type: 'primitive', geometryType: 'cube', materialType: 'color', color: '#808080', isCollider: true, opacity: 0.5 };

    case 'camera':
      return { ...base, type: 'camera', fov: 45, orthoSize: 10, near: 0.1, far: 100, isDefault: false, targetLookAt: '' };

    case 'light':
      return { ...base, type: 'light', lightType: 'point', color: '#ffffff', intensity: 1, distance: 10, castShadows: false };

    case 'sound':
      return { ...base, type: 'sound', audioSource: '', volume: 1, loop: true, spatialAudio: true, refDistance: 1, maxDistance: 20 };

    case 'trigger':
      return { ...base, type: 'trigger', shape: 'box', onEnterEvent: '', onLeaveEvent: '', triggerOnce: false, extents: { x: 2, y: 2, z: 2 } };

    case 'spawn':
      return { ...base, type: 'spawn', spawnId: 'spawn_default', initialFacing: { x: 0, y: 0, z: -1 } };
  }
}
