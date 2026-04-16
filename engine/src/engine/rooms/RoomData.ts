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
    /** Entity type from editor: 'sprite' | 'animated_sprite' | 'primitive' | 'light' */
    entityType?: string;
    /** For primitives: geometry type */
    geometryType?: string;
    /** For primitives: color */
    color?: string;
    /** For primitives: opacity */
    opacity?: number;
    /** For lights: light config */
    lightType?: string;
    lightColor?: string;
    lightIntensity?: number;
    lightDistance?: number;
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
    cameraPosition: { x: number; y: number; z: number };
    cameraRotation: { x: number; y: number; z: number };
    cameraFov?: number;
    cameraNear?: number;
    cameraFar?: number;
    ambientColor: string;
    /** Inward padding from walls for the navigable area (world units). Default 1.5 */
    walkPadding?: number;
}
