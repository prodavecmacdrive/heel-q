import { System } from '../ecs/System';
import { World } from '../ecs/World';
import { SCALE_STEPS } from '../constants';
import * as THREE from 'three';
import { MeshRenderer, Sprite, Transform } from '../ecs/Component';

/**
 * SpriteSystem — billboarding + discrete scaling + feet-first Y offset.
 *
 * Transform.position is the FEET position on the floor.
 * This system:
 *   1. Sets mesh quaternion to face the camera (billboarding)
 *   2. Computes discrete scale step from camera distance
 *   3. Offsets the mesh Y upward by half the SCALED height so
 *      the sprite's bottom edge sits at the feet position.
 */
export class SpriteSystem extends System {
    private camera: THREE.Camera;

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

            // 1. Billboarding
            renderer.mesh.quaternion.copy(this.camera.quaternion);

            // 2. Discrete scaling logic (Linear Perspective Normalization)
            // Calculate distance based primarily on Z-depth for a consistent scaling curve
            const cameraZ = this.camera.position.z;
            const objectZ = transform.position.z;
            
            // Assume 0 is origin, objects might go back to -12, camera at 8
            const zDistance = Math.abs(cameraZ - objectZ);
            
            // Normalize distance to a 0.0 - 1.0 factor over an expected max depth of 20 units
            const distanceFactor = Math.max(0, Math.min(1, zDistance / 20));
            
            // The scaling curve: keep characters substantial even at far planes
            const maxScale = 1.0;
            const minScale = 0.65; // Never shrink below 65% size
            
            let rawScale = maxScale + (minScale - maxScale) * distanceFactor;
            rawScale += sprite.discreteScaleOffset || 0;
            
            // Quantize to steps to maintain chunky retro feel, but fine enough to avoid harsh popping
            const stepSize = 0.05;
            let bestStep = Math.round(rawScale / stepSize) * stepSize;
            bestStep = Math.max(minScale, Math.min(maxScale + (sprite.discreteScaleOffset || 0), bestStep));

            const scaledW = sprite.baseWidth * bestStep;
            const scaledH = sprite.baseHeight * bestStep;

            renderer.mesh.scale.set(scaledW, scaledH, 1);

            // 3. Feet-first offset: shift mesh up by half the scaled height
            //    so the bottom edge sits at transform.position.y (the floor)
            (renderer.mesh as THREE.Mesh).position.y = transform.position.y + scaledH / 2;
        }
    }
}
