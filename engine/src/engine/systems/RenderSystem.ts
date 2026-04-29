import { System } from '../ecs/System';
import { World } from '../ecs/World';
import { PixelRenderer } from '../rendering/PixelRenderer';
import { CameraSystem } from './CameraSystem';
import * as THREE from 'three';

export class RenderSystem extends System {
    private renderer: PixelRenderer;
    private scene: THREE.Scene;
    private camera: THREE.Camera;
    private cameraSystem: CameraSystem | null = null;

    constructor(world: World, renderer: PixelRenderer, scene: THREE.Scene, camera: THREE.Camera) {
        super(world);
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
    }

    update(dt: number) {
        // Find CameraSystem if not cached
        if (!this.cameraSystem) {
            this.cameraSystem = this.world.getSystem(CameraSystem) as CameraSystem;
        }

        // 1. Render main view
        this.renderer.render(this.scene, this.camera);

        // 2. Render multi-camera thumbnails if available
        if (this.cameraSystem) {
            const cameras = this.cameraSystem.getCameraInfo();
            const activeIndex = this.cameraSystem.getActiveCameraIndex();
            this.renderer.renderThumbnails(this.scene, cameras, activeIndex);
        }
    }
}
