import { System } from '../ecs/System';
import { World } from '../ecs/World';
import * as THREE from 'three';
import { Player, MeshRenderer, Transform, DoorMarker } from '../ecs/Component';
import { PixelRenderer } from '../rendering/PixelRenderer';
import { RoomManager } from '../rooms/RoomManager';

/**
 * InputSystem — Point-and-Click with A* pathfinding.
 *
 * Raycasts onto FloorMarker meshes.  The hit point is clamped within the
 * NavGrid's padded boundaries, then A* computes a multi-node path that
 * is pushed to Player.path for the MovementSystem to follow.
 */
export class InputSystem extends System {
    private camera: THREE.Camera;
    private raycaster: THREE.Raycaster;
    private mouse: THREE.Vector2;
    private pixelRenderer: PixelRenderer;
    private roomManager: RoomManager;

    constructor(
        world: World,
        camera: THREE.Camera,
        pixelRenderer: PixelRenderer,
        private scene: THREE.Scene,
        roomManager: RoomManager
    ) {
        super(world);
        this.camera = camera;
        this.pixelRenderer = pixelRenderer;
        this.roomManager = roomManager;
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        pixelRenderer.getDomElement().addEventListener('pointerdown', this.onPointerDown.bind(this));
    }

    private getInteractableMeshes(): { mesh: THREE.Object3D, isDoor: boolean, entity: import('../ecs/Entity').Entity }[] {
        const result: { mesh: THREE.Object3D, isDoor: boolean, entity: import('../ecs/Entity').Entity }[] = [];
        
        const floorEntities = this.world.queryEntities(['FloorMarker', 'MeshRenderer']);
        for (const e of floorEntities) {
            const mr = this.world.getComponent(e, 'MeshRenderer') as MeshRenderer;
            result.push({ mesh: mr.mesh, isDoor: false, entity: e });
        }

        const doorEntities = this.world.queryEntities(['DoorMarker', 'MeshRenderer']);
        for (const e of doorEntities) {
            const mr = this.world.getComponent(e, 'MeshRenderer') as MeshRenderer;
            result.push({ mesh: mr.mesh, isDoor: true, entity: e });
        }
        return result;
    }

    private onPointerDown(event: PointerEvent) {
        const vx = this.pixelRenderer.viewportX;
        const vy = this.pixelRenderer.viewportY;
        const vw = this.pixelRenderer.viewportWidth;
        const vh = this.pixelRenderer.viewportHeight;

        const localX = event.clientX - vx;
        const localY = event.clientY - vy;
        if (localX < 0 || localY < 0 || localX > vw || localY > vh) return;

        this.mouse.x = (localX / vw) * 2 - 1;
        this.mouse.y = -(localY / vh) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);

        const meshesData = this.getInteractableMeshes();
        const meshes = meshesData.map(d => d.mesh);
        const intersects = this.raycaster.intersectObjects(meshes, false);

        if (intersects.length > 0) {
            // Sort to ensure doors take priority if both were hit
            intersects.sort((a, b) => {
                const aData = meshesData.find(d => d.mesh === a.object);
                const bData = meshesData.find(d => d.mesh === b.object);
                if (aData?.isDoor && !bData?.isDoor) return -1;
                if (!aData?.isDoor && bData?.isDoor) return 1;
                return a.distance - b.distance;
            });

            const hit = intersects[0];
            const hitData = meshesData.find(d => d.mesh === hit.object);
            const nav = this.roomManager.navGrid;

            const players = this.world.queryEntities(['Player', 'Transform']);
            if (players.length > 0) {
                const playerEntity = players[0];
                const player = this.world.getComponent(playerEntity, 'Player') as Player;
                const transform = this.world.getComponent(playerEntity, 'Transform') as Transform;

                if (hitData && hitData.isDoor) {
                    const doorMarker = this.world.getComponent(hitData.entity, 'DoorMarker') as DoorMarker;
                    player.pendingPortalId = doorMarker.portalId;
                    
                    const doorTransform = this.world.getComponent(hitData.entity, 'Transform') as Transform;
                    const target = nav.clamp(new THREE.Vector3(doorTransform.position.x, player.floorY, doorTransform.position.z));
                    const path = nav.findPath(transform.position, target);
                    player.path = path;
                } else {
                    player.pendingPortalId = null;
                    const target = nav.clamp(new THREE.Vector3(hit.point.x, player.floorY, hit.point.z));
                    const path = nav.findPath(transform.position, target);
                    player.path = path;
                }
            }
        }
    }

    update(_dt: number) {
        // Event-driven
    }
}
