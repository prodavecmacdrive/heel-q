import { System } from '../ecs/System';
import { World } from '../ecs/World';
import { CameraMarker, Transform } from '../ecs/Component';
import { RoomManager } from '../rooms/RoomManager';
import { PixelRenderer } from '../rendering/PixelRenderer';
import * as THREE from 'three';

/**
 * CameraSystem — manages multi-camera switching within a room.
 */
export class CameraSystem extends System {
    private camera: THREE.PerspectiveCamera;
    private roomManager: RoomManager;
    private renderer: PixelRenderer;
    private activeCameraIndex: number = 0;
    private cameraEntities: number[] = [];
    private lastRoomId: string | null = null;

    constructor(world: World, camera: THREE.PerspectiveCamera, roomManager: RoomManager, renderer: PixelRenderer) {
        super(world);
        this.camera = camera;
        this.roomManager = roomManager;
        this.renderer = renderer;

        document.addEventListener('keydown', (e) => {
            const num = parseInt(e.key);
            if (num >= 1 && num <= 9) {
                this.switchCamera(num - 1);
            }
        });

        // Click to switch via thumbnails
        window.addEventListener('mousedown', (e) => {
            this.handleThumbnailClick(e);
        });
    }

    private handleThumbnailClick(e: MouseEvent) {
        if (this.cameraEntities.length <= 1) return;

        // Use same math as PixelRenderer for hit detection
        const thumbWidth = Math.floor(this.renderer.viewportWidth * 0.15);
        const thumbHeight = Math.floor(thumbWidth / (16 / 9));
        const padding = 10;

        // Mouse Y is top-down in screen space
        const mouseX = e.clientX;
        const mouseY = window.innerHeight - e.clientY; // Invert to match viewport Y

        for (let i = 0; i < this.cameraEntities.length; i++) {
            if (i === this.activeCameraIndex) continue;

            const relativeIdx = i > this.activeCameraIndex ? i - 1 : i;
            const x = this.renderer.viewportX + this.renderer.viewportWidth - thumbWidth - padding;
            const y = this.renderer.viewportY + padding + relativeIdx * (thumbHeight + padding);

            if (this.renderer.isInsideRect(mouseX, mouseY, x, y, thumbWidth, thumbHeight)) {
                this.switchCamera(i);
                break;
            }
        }
    }

    update(_dt: number) {
        // Detect room change and refresh camera list
        if (this.roomManager.currentRoomId !== this.lastRoomId) {
            this.lastRoomId = this.roomManager.currentRoomId;
            this.refreshCameraList();
        }

        // Apply LookAt tracking for active camera
        if (this.cameraEntities.length > 0 && this.activeCameraIndex < this.cameraEntities.length) {
            const camEntity = this.cameraEntities[this.activeCameraIndex];
            const camMarker = this.world.getComponent(camEntity, 'CameraMarker') as CameraMarker | undefined;

            if (camMarker?.targetLookAt) {
                // Find the target entity by scanning for matching IDs
                // Since we don't store string IDs in ECS, we search meshes for userData
                const allEntities = this.world.queryEntities(['Transform']);
                for (const ent of allEntities) {
                    const mr = this.world.getComponent(ent, 'MeshRenderer');
                    if (mr && (mr as any).mesh?.userData?.lookAtId === camMarker.targetLookAt) {
                        const targetTransform = this.world.getComponent(ent, 'Transform') as Transform;
                        if (targetTransform) {
                            this.camera.lookAt(targetTransform.position);
                        }
                        break;
                    }
                }
            }
        }
    }

    private refreshCameraList() {
        this.cameraEntities = this.world.queryEntities(['CameraMarker']);
        this.activeCameraIndex = 0;

        // Find default camera
        for (let i = 0; i < this.cameraEntities.length; i++) {
            const cam = this.world.getComponent(this.cameraEntities[i], 'CameraMarker') as CameraMarker;
            if (cam.isDefault) {
                this.activeCameraIndex = i;
                break;
            }
        }

        if (this.cameraEntities.length > 0) {
            this.applyCamera(this.activeCameraIndex);
        }
    }

    public switchCamera(index: number) {
        if (index < 0 || index >= this.cameraEntities.length) return;
        this.activeCameraIndex = index;
        this.applyCamera(index);
    }

    private applyCamera(index: number) {
        const entity = this.cameraEntities[index];
        const transform = this.world.getComponent(entity, 'Transform') as Transform;
        const camMarker = this.world.getComponent(entity, 'CameraMarker') as CameraMarker;

        if (!transform) return;

        this.camera.position.copy(transform.position);
        
        // If no lookAt target, use rotation directly
        if (!camMarker.targetLookAt) {
            this.camera.rotation.copy(transform.rotation);
        }

        if (camMarker.fov) {
            this.camera.fov = camMarker.fov;
            this.camera.updateProjectionMatrix();
        }
    }

    public getActiveCameraIndex(): number {
        return this.activeCameraIndex;
    }

    public getCameraCount(): number {
        return this.cameraEntities.length;
    }

    public getCameraInfo() {
        return this.cameraEntities.map(entity => {
            const transform = this.world.getComponent(entity, 'Transform') as Transform;
            const marker = this.world.getComponent(entity, 'CameraMarker') as CameraMarker;
            return {
                position: transform.position.clone(),
                rotation: transform.rotation.clone(),
                fov: marker.fov || 45
            };
        });
    }
}
