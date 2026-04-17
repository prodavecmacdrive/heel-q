import * as THREE from 'three';

// ─── Base components ───────────────────────────────────────────────

/**
 * Transform stores the logical position of an entity.
 * For sprite entities this is the FEET position (bottom-center on the floor).
 * The visual mesh is offset upward by the SpriteSystem.
 */
export interface Transform {
    position: THREE.Vector3;
    rotation: THREE.Euler;
    scale: THREE.Vector3;
}

export interface Sprite {
    textureKey: string;
    frame: number;
    baseWidth: number;
    baseHeight: number;
    discreteScaleOffset: number;
}

export interface MeshRenderer {
    mesh: THREE.Object3D;
}

export interface Collider {
    width: number;
    depth: number;
    height: number;
    isTrigger: boolean;
}

export interface Portal {
    targetRoom: string;
    spawnPosition: THREE.Vector3;
}

export interface Interactable {
    label: string;
    onClick: () => void;
    isHovered: boolean;
}

export interface RoomMember {
    roomId: string;
}

/**
 * Player component.
 * - path: ordered list of XZ waypoints from A* pathfinding
 * - floorY: the Y of the floor surface (feet sit here)
 */
export interface Player {
    path: THREE.Vector3[];       // waypoint queue (feet positions)
    speed: number;
    isMoving: boolean;
    floorY: number;              // floor surface Y (typically 0)
    /** Set when the player clicks a door — stores the portal ID to trigger after arriving */
    pendingPortalId: string | null;
}

// ─── Animation component ──────────────────────────────────────────

export interface SpriteAnimation {
    columns: number;
    rows: number;
    totalFrames: number;
    currentFrame: number;
    frameRate: number;
    timeAccumulator: number;
    state: 'idle' | 'walk';
    stateFrames: Record<string, { start: number; end: number }>;
}

// ─── Atlas animation component (Texture Packer pixel-coordinate frames) ──

export interface AtlasAnimation {
    frames: Array<{x: number; y: number; w: number; h: number}>;
    imageWidth: number;
    imageHeight: number;
    currentFrame: number;
    frameRate: number;
    timeAccumulator: number;
    loop: boolean;
    autoplay: boolean;
}

// ─── Marker tags ──────────────────────────────────────────────────

export interface FloorMarker {
    _tag: true;
}

/** Tags an entity as a blocking obstacle on the XZ nav grid */
export interface Obstacle {
    /** Half-extents on XZ used to stamp blocked cells */
    halfWidth: number;
    halfDepth: number;
}

/** Tags a door entity — carries the portal ID for click-to-transition */
export interface DoorMarker {
    portalId: string;
    targetRoom: string;
    targetSpawnId?: string;
    interactionState?: string;
}

/** Tags a camera entity for multi-camera room switching */
export interface CameraMarker {
    cameraIndex: number;
    isDefault: boolean;
    targetLookAt: string;
    fov: number;
}

// ─── Component registry ───────────────────────────────────────────

export interface ComponentRegistry {
    'Transform': Transform;
    'Sprite': Sprite;
    'MeshRenderer': MeshRenderer;
    'Collider': Collider;
    'Portal': Portal;
    'Interactable': Interactable;
    'RoomMember': RoomMember;
    'Player': Player;
    'SpriteAnimation': SpriteAnimation;
    'FloorMarker': FloorMarker;
    'Obstacle': Obstacle;
    'DoorMarker': DoorMarker;
    'CameraMarker': CameraMarker;
    'AtlasAnimation': AtlasAnimation;
}

export type ComponentName = keyof ComponentRegistry;
