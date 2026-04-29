import { System } from '../ecs/System';
import { World } from '../ecs/World';
import { Player, Transform, SpriteAnimation } from '../ecs/Component';
import type { RoomManager } from '../rooms/RoomManager';
import * as THREE from 'three';

/**
 * MovementSystem — follows multi-node A* paths on the XZ floor plane.
 *
 * The player's path[] is a queue of waypoints.  The system walks toward
 * the first waypoint; when it arrives, it shifts to the next.  When the
 * queue is empty, movement stops and animation flips to idle.
 * Y is computed each frame as terrainHeight(playerX, playerZ) so the player
 * automatically follows sloped or elevated terrain surfaces.
 */
export class MovementSystem extends System {
    private roomManager: RoomManager;

    constructor(world: World, roomManager: RoomManager, _camera?: THREE.Camera) {
        super(world);
        this.roomManager = roomManager;
    }

    update(dt: number) {
        const entities = this.world.queryEntities(['Transform', 'Player']);

        for (const entity of entities) {
            const transform = this.world.getComponent(entity, 'Transform') as Transform;
            const player = this.world.getComponent(entity, 'Player') as Player;

            if (player.path.length > 0) {
                const target = player.path[0];
                const dx = target.x - transform.position.x;
                const dz = target.z - transform.position.z;
                const dist = Math.sqrt(dx * dx + dz * dz);

                if (dist < 0.2) {
                    // Reached this waypoint — advance to next
                    transform.position.x = target.x;
                    transform.position.z = target.z;
                    player.path.shift();

                    if (player.path.length === 0) {
                        player.isMoving = false;
                    }
                } else {
                    const step = player.speed * dt;
                    const move = Math.min(step, dist);
                    transform.position.x += (dx / dist) * move;
                    transform.position.z += (dz / dist) * move;
                    player.isMoving = true;
                }

                // Lock Y to terrain surface at current XZ
                transform.position.y = this.roomManager.getFloorY(
                    transform.position.x, transform.position.z
                ) + player.floorY;  // player.floorY is the offset above terrain (normally 0)
            } else {
                player.isMoving = false;
            }

            // Sync animation state
            const anim = this.world.getComponent(entity, 'SpriteAnimation');
            if (anim) {
                (anim as SpriteAnimation).state = player.isMoving ? 'walk' : 'idle';
            }
        }
    }
}
