import { System } from '../ecs/System';
import { World } from '../ecs/World';
import * as THREE from 'three';
import { Player, Transform, SpriteAnimation } from '../ecs/Component';
import { RoomManager } from '../rooms/RoomManager';
import { RoomData } from '../rooms/RoomData';

/**
 * PortalSystem — detects when the player's FEET position enters a portal
 * trigger volume and executes the room transition lifecycle:
 *   1. Halt movement + animations
 *   2. Preserve the Player entity
 *   3. RoomManager tears down old room, builds new one
 *   4. Snap player to the portal's designated spawn point
 */
export class PortalSystem extends System {
    private roomManager: RoomManager;
    private availableRooms: Record<string, RoomData>;
    private transitioning: boolean = false;

    constructor(
        world: World,
        roomManager: RoomManager,
        availableRooms: Record<string, RoomData>
    ) {
        super(world);
        this.roomManager = roomManager;
        this.availableRooms = availableRooms;
    }

    update(_dt: number) {
        if (!this.roomManager.currentRoomId || this.transitioning) return;

        const currentRoomData = this.availableRooms[this.roomManager.currentRoomId];
        if (!currentRoomData?.portals) return;

        const players = this.world.queryEntities(['Player', 'Transform']);
        if (players.length === 0) return;

        const playerEntity = players[0];
        const transform = this.world.getComponent(playerEntity, 'Transform') as Transform;
        const player = this.world.getComponent(playerEntity, 'Player') as Player;

        // Check if player has arrived at their clicked portal
        if (player.pendingPortalId && !player.isMoving) {
            const px = transform.position.x;
            const pz = transform.position.z;
            const portal = currentRoomData.portals.find(p => p.id === player.pendingPortalId);
            if (portal) {
                const hpw = Math.max(portal.boundary.width / 2, 1.5); // Use a generous interaction distance
                const hpd = Math.max(portal.boundary.depth / 2, 1.5);

                // 2D check on XZ (feet plane) — ignore Y entirely
                if (
                    Math.abs(px - portal.position.x) < hpw &&
                    Math.abs(pz - portal.position.z) < hpd
                ) {
                    this.transitioning = true;

                    // 1. Halt movement + animation
                    player.path = [];
                    player.isMoving = false;
                    const anim = this.world.getComponent(playerEntity, 'SpriteAnimation');
                    if (anim) (anim as SpriteAnimation).state = 'idle';

                    console.log(`Portal → ${portal.targetRoom}`);

                const nextRoom = this.availableRooms[portal.targetRoom];
                if (!nextRoom) { this.transitioning = false; return; }

                let spawnPos = portal.spawnPosition || {x: 0, y: 0, z: 0};
                if (portal.targetSpawnId && nextRoom.spawnPoints) {
                    // Use explicitly designated spawn point
                    const sp = nextRoom.spawnPoints.find(s => s.id === portal.targetSpawnId);
                    if (sp) spawnPos = sp.position;
                } else if (portal.id && nextRoom.portals) {
                    // Land next to the matching door in the target room, clamped to
                    // the nav grid so the player always starts in a walkable cell.
                    const matchingPortal = nextRoom.portals.find(p => p.id === portal.id);
                    if (matchingPortal) {
                        // Clamp door position to the nearest walkable cell so the
                        // player doesn't spawn inside the door's obstacle stamp.
                        const raw = new THREE.Vector3(
                            matchingPortal.position.x,
                            0,
                            matchingPortal.position.z
                        );
                        const clamped = this.roomManager.navGrid.clamp(raw);
                        spawnPos = { x: clamped.x, y: matchingPortal.position.y, z: clamped.z };
                    } else if (nextRoom.spawnPoints && nextRoom.spawnPoints.length > 0) {
                        spawnPos = nextRoom.spawnPoints[0].position;
                    }
                } else if (nextRoom.spawnPoints && nextRoom.spawnPoints.length > 0) {
                    spawnPos = nextRoom.spawnPoints[0].position;
                }

                // 2-5. RoomManager handles teardown/rebuild with player preservation
                this.roomManager.loadRoom(nextRoom).then(() => {
                    // 6. Snap player feet to spawn point
                    // After loadRoom the navGrid is rebuilt — clamp again to the
                    // updated grid so we never strand the player in a blocked cell.
                    const nav = this.roomManager.navGrid;
                    const clampedFinal = nav.clamp(
                        new THREE.Vector3(spawnPos.x, 0, spawnPos.z)
                    );

                    const t = this.world.getComponent(playerEntity, 'Transform') as Transform;
                    const p = this.world.getComponent(playerEntity, 'Player') as Player;
                    t.position.x = clampedFinal.x;
                    t.position.z = clampedFinal.z;
                    t.position.y = p.floorY;
                    p.path = [];
                    p.isMoving = false;

                    this.transitioning = false;
                }).catch((err: unknown) => {
                    // Room load failed — reset so future portal clicks still work
                    console.error('PortalSystem: loadRoom failed, resetting transition state', err);
                    this.transitioning = false;
                    player.pendingPortalId = null;
                });
                } // <--- Added missing brace here

                // Reset pending interaction
                player.pendingPortalId = null;
            } else {
                // Stopped moving but not near a valid portal (or portal was invalid)
                player.pendingPortalId = null;
            }
        }
    }
}
