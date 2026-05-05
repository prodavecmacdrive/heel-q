import { System } from '../ecs/System';
import { World } from '../ecs/World';
import * as THREE from 'three';
import { MeshRenderer, Sprite, Transform } from '../ecs/Component';

/**
 * SpriteSystem — billboarding + discrete scaling + feet-first Y offset.
 *
 * Transform.position is the FEET position on the floor.
 * This system:
 *   1. Rotates the mesh according to the sprite's `billboardMode`:
 *      - 'face_camera' — full spherical billboard: copies the active camera's
 *        quaternion so the sprite plane's normal always points at the camera.
 *      - 'y_axis'      — cylindrical Y-up billboard (default): rotates around
 *        world-Y only so the sprite faces the camera horizontally while
 *        remaining perfectly vertical — feet always on the floor regardless
 *        of camera tilt or elevation.
 *      - 'fixed'       — no automatic rotation; mesh keeps its placed rotation.
 *   2. Computes discrete scale step from camera distance.
 *   3. Offsets the mesh Y upward by half the SCALED height so the sprite's
 *      bottom edge sits at the feet position.
 */
export class SpriteSystem extends System {
    private camera: THREE.Camera;
    private _yAxis = new THREE.Vector3(0, 1, 0);

    constructor(world: World, camera: THREE.Camera) {
        super(world);
        this.camera = camera;
    }

    update(_dt: number) {
        const entities = this.world.queryEntities(['Transform', 'Sprite', 'MeshRenderer']);

        for (const entity of entities) {
            const transform = this.world.getComponent(entity, 'Transform') as Transform;
            const renderer = this.world.getComponent(entity, 'MeshRenderer') as MeshRenderer;
            const sprite = this.world.getComponent(entity, 'Sprite') as Sprite;

            const mode = sprite.billboardMode ?? 'y_axis';

            // 1. Billboarding — all non-fixed modes use cylindrical Y-axis rotation.
            // The sprite plane is always kept vertical; only the horizontal yaw changes
            // so the face always looks toward the camera without any X/Z tilt.
            if (mode !== 'fixed') {
                // Cylindrical Y-up billboard: rotate around world-Y only.
                const dx = this.camera.position.x - transform.position.x;
                const dz = this.camera.position.z - transform.position.z;
                const angle = Math.atan2(dx, dz);
                renderer.mesh.quaternion.setFromAxisAngle(this._yAxis, angle);
            }
            // 'fixed' — no rotation update; mesh keeps its last/placed rotation.

            // 2. Discrete scaling logic that uses real camera distance for better
            //    perspective consistency as the character moves away from the view.
            const dx = this.camera.position.x - transform.position.x;
            const dy = this.camera.position.y - transform.position.y;
            const dz = this.camera.position.z - transform.position.z;
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const distanceFactor = Math.max(0, Math.min(1, distance / 20));

            const maxScale = 0.86;
            const minScale = 0.65;
            let rawScale = maxScale + (minScale - maxScale) * distanceFactor;
            rawScale += sprite.discreteScaleOffset || 0;

            const stepSize = 0.05;
            let bestStep = Math.round(rawScale / stepSize) * stepSize;
            bestStep = Math.max(minScale, Math.min(maxScale + (sprite.discreteScaleOffset || 0), bestStep));

            const scaledW = sprite.baseWidth * bestStep;
            const scaledH = sprite.baseHeight * bestStep;

            renderer.mesh.scale.set(scaledW, scaledH, 1);

            // 3. Feet-first offset: move the sprite so the sprite's foot anchor row
            //    sits at transform.position.y (the floor / feet world position).
            //
            //    feetAnchor = 0   → feet at the very bottom of the quad (default).
            //    feetAnchor = 0.3 → feet 30 % from the bottom (atlas has padding below).
            //
            //    Formula: center_y = feet_y + scaledH * (0.5 - feetAnchor)
            const feetAnchor = sprite.feetAnchor ?? 0;
            (renderer.mesh as THREE.Mesh).position.y =
                transform.position.y + scaledH * (0.5 - feetAnchor);
        }
    }
}
