export interface EntitySpawnDef {
    spriteKey: string;
    width: number;
    height: number;
    position: { x: number; y: number; z: number };
    rotation?: { x: number; y: number; z: number };
    scale?: { x: number; y: number; z: number };
    /** If true, this entity blocks navigation (stamped onto the nav grid) */
    isObstacle?: boolean;
    /** XZ half-extents for obstacle blocking (defaults to width/2 × 0.5) */
    obstacleHalfWidth?: number;
    obstacleHalfDepth?: number;
    /** Entity type from editor: 'sprite' | 'animated_sprite' | 'primitive' | 'light' | 'door' */
    entityType?: string;
    /** For primitives: geometry type */
    geometryType?: string;
    /** For primitives: color */
    color?: string;
    /** For primitives: opacity */
    opacity?: number;
    /** For primitives: texture source */
    textureSource?: string;
    /** For primitives: UV tiling */
    uvTilingX?: number;
    uvTilingY?: number;
    uvOffsetX?: number;
    uvOffsetY?: number;
    /** For lights: light config */
    lightType?: string;
    lightColor?: string;
    lightIntensity?: number;
    lightDistance?: number;
    /** For doors */
    targetRoomId?: string;
    targetSpawnId?: string;
    interactionState?: string;
    /** Links to the WorldProject.doors[].id for portal matching */
    portalId?: string;
    /** For animated_sprite: Texture Packer atlas JSON filename (e.g. "customer.json") */
    sequenceJson?: string;
    /** For animated_sprite: sprite/atlas source image identifier (same key used in TextureManager) */
    sequenceSource?: string;
    /** Pre-parsed Texture Packer atlas frames (pixel coordinates) — populated during preload */
    atlasFrames?: Array<{x: number; y: number; w: number; h: number}>;
    /** Atlas sheet dimensions (populated during preload) */
    imageWidth?: number;
    imageHeight?: number;
    /** Animation playback */
    fps?: number;
    loop?: boolean;
    autoplay?: boolean;
    /** For uniform-grid sprite sheets (fallback when no atlas JSON is present) */
    sheetColumns?: number;
    sheetRows?: number;
    /** For sound entities */
    audioSource?: string;
    volume?: number;
    spatialAudio?: boolean;
}

export interface CameraDef {
    id?: string;
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    fov: number;
    near: number;
    far: number;
    isDefault: boolean;
    targetLookAt: string;
}

export interface WallDef {
    width: number;
    height: number;
    texture: string;
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
}

export interface PortalDef {
    id?: string;
    targetRoom: string;
    targetSpawnId?: string;
    spawnPosition: { x: number; y: number; z: number }; // fallback
    boundary: { width: number; height: number; depth: number };
    position: { x: number; y: number; z: number };
}

export interface SpawnPointDef {
    id: string;
    position: { x: number; y: number; z: number };
}

export interface RoomData {
    id: string;
    name: string;
    boundaries: {
        floor: {
            width: number;
            depth: number;
            texture: string;
            position?: { x: number; y: number; z: number };
        };
        walls: WallDef[];
    };
    outline: { x: number; y: number }[];
    entities: EntitySpawnDef[];
    portals: PortalDef[];
    spawnPoints?: SpawnPointDef[];
    /** Multi-camera array — first camera with isDefault or first added is the active default */
    cameras: CameraDef[];
    /** Legacy single camera fields (used as fallback if cameras[] is empty) */
    cameraPosition: { x: number; y: number; z: number };
    cameraRotation: { x: number; y: number; z: number };
    cameraFov?: number;
    cameraNear?: number;
    cameraFar?: number;
    cameraLookAt?: { x: number; y: number; z: number };
    ambientColor: string;
    /** Inward padding from walls for the navigable area (world units). Default 1.5 */
    walkPadding?: number;
    /** Character speed from spawn entity */
    characterSpeed?: number;
    /** Character asset source */
    characterAsset?: string;
}
