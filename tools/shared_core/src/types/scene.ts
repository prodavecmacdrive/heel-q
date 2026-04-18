/* ═══════════════════════════════════════════════════════════════════════
   Scene / Map data structures — shared between engine and editor
   ═══════════════════════════════════════════════════════════════════════ */

import type { EditorEntity, Vec3 } from './entities';

export interface Vec2 {
  x: number;
  y: number;
}

/** Door connecting rooms, placed on walls */
export interface DoorDef {
  id: string;
  points: [Vec2, Vec2]; // The 2D line segment representing the door in World Map
  room1Id: string;
  room2Id: string | null; // connected room, if any
  width: number;
  texture: string;
}

/** A Single Room representing its contents */
export interface RoomData {
  id: string;
  name: string;

  /** The 2D outline drawn in the World Map (clockwise/ccw vertices) */
  outline: Vec2[];

  /** All placed entities inside this room */
  entities: EditorEntity[];

  /** Named spawn points (derived from SpawnEntity) */
  spawnPoints: { id: string; position: Vec3 }[];

  /** Walk padding from walls */
  walkPadding: number;

  /** Ambient lighting */
  ambientColor: string;
  
  /** Height map grid data (flat if not altered) */
  heightMap: number[]; // e.g. a grid inside bounding box

  /** Per-vertex rounding radii for the outline (same length as outline). 0 = sharp corner. */
  cornerRadii?: number[];
}

/** Full Map/World data containing all rooms and doors */
export interface WorldProject {
  version: string;
  projectId: string;
  rooms: RoomData[];
  doors: DoorDef[];
  
  /**
   * Currently selected room in editor.
   * Editor-only field — stripped before syncing to the engine.
   */
  activeRoomId?: string | null; 
}

/** Create a blank new World */
export function createDefaultWorld(): WorldProject {
  return {
    version: '1.0.0',
    projectId: 'new_world',
    rooms: [],
    doors: [],
    activeRoomId: null,
  };
}

export function createDefaultRoom(id: string): RoomData {
  return {
    id,
    name: 'New Room',
    outline: [],
    entities: [],
    spawnPoints: [],
    walkPadding: 1.0,
    ambientColor: '#2b5a5b',
    heightMap: [],
    cornerRadii: [],
  };
}
