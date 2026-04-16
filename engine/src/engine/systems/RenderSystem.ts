import { System } from '../ecs/System';
import { World } from '../ecs/World';
import { PixelRenderer } from '../rendering/PixelRenderer';
import * as THREE from 'three';

export class RenderSystem extends System {
    private renderer: PixelRenderer;
    private scene: THREE.Scene;
    private camera: THREE.Camera;

    constructor(world: World, renderer: PixelRenderer, scene: THREE.Scene, camera: THREE.Camera) {
        super(world);
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
    }

    update(dt: number) {
        // Just delegates to PixelRenderer.
        // ECS systems process data, renderer outputs the result.
        this.renderer.render(this.scene, this.camera);
    }
}
