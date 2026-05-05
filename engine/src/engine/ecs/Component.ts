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
    /** Controls how the sprite plane is oriented toward the camera each frame.
     *  'y_axis'     — cylindrical Y-up billboard (default; sprite stays vertical).
     *  'face_camera' — full spherical billboard (sprite plane normal = camera direction).
     *  'fixed'      — no automatic rotation (mesh keeps its placed rotation).
     */
    billboardMode?: 'y_axis' | 'face_camera' | 'fixed';
    /**
     * Fraction (0–1) from the BOTTOM of the sprite frame where the character's feet are.
     * 0 = feet at the very bottom of the quad (default, suits textures with feet touching
     *     the lower edge).
     * 0.3 = feet 30 % from the bottom (useful when the atlas has empty padding at the bottom).
     *
     * SpriteSystem uses this to shift the quad so the indicated row sits at
     * transform.position.y (the floor/feet position).
     */
    feetAnchor?: number;
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

export type FacingDirection = 'down' | 'up' | 'left' | 'right';

export interface CharacterControl {
    facing: FacingDirection;
    action: string;
    requestedAction: string | null;
    currentGroup: string;
    frameGroups: Record<string, number[]>;
    sourceFrames: Array<{ x: number; y: number; w: number; h: number; filename?: string }>;
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
    sourceId?: string;
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
    'CharacterControl': CharacterControl;
    'SpriteAnimation': SpriteAnimation;
    'FloorMarker': FloorMarker;
    'Obstacle': Obstacle;
    'DoorMarker': DoorMarker;
    'CameraMarker': CameraMarker;
    'AtlasAnimation': AtlasAnimation;
}

export type ComponentName = keyof ComponentRegistry;
