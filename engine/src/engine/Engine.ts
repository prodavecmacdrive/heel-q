import * as THREE from 'three';
import { World } from './ecs/World';
import { PixelRenderer } from './rendering/PixelRenderer';
import { TextureManager } from './rendering/TextureManager';
import { RoomManager } from './rooms/RoomManager';
import { RoomData } from './rooms/RoomData';
import { RoomNotFoundError } from '../errors';

// Systems
import { SpriteSystem } from './systems/SpriteSystem';
import { RenderSystem } from './systems/RenderSystem';
import { PixelSnapSystem } from './systems/PixelSnapSystem';
import { MovementSystem } from './systems/MovementSystem';
import { PortalSystem } from './systems/PortalSystem';
import { InputSystem } from './systems/InputSystem';
import { AnimationSystem } from './systems/AnimationSystem';
import { DepthSortSystem } from './systems/DepthSortSystem';
import { CameraSystem } from './systems/CameraSystem';

export class Engine {
    private world: World;
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private renderer: PixelRenderer;
    private textureManager: TextureManager;
    private roomManager: RoomManager;

    private availableRooms: Record<string, RoomData> = {};
    private lastTime: number = 0;
    private running: boolean = false;

    constructor(canvas: HTMLCanvasElement) {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100);
        this.renderer = new PixelRenderer(canvas);
        this.textureManager = new TextureManager();
        this.world = new World();
        this.roomManager = new RoomManager(
            this.world, this.scene, this.textureManager, this.camera
        );
    }

    public registerRooms(rooms: RoomData[]) {
        for (const room of rooms) {
            this.availableRooms[room.id] = room;
        }
    }

    public getTextureManager(): TextureManager {
        return this.textureManager;
    }

    public getRoomManager(): RoomManager {
        return this.roomManager;
    }

    public async loadRoom(roomId: string) {
        const room = this.availableRooms[roomId];
        if (!room) {
            throw new RoomNotFoundError(roomId);
        }

        await this.roomManager.loadRoom(room);
    }

    public start() {
        // ── System registration order ──
        // 1. Input (event-driven, registered first)
        this.world.addSystem(
            new InputSystem(
                this.world, this.camera, this.renderer,
                this.scene, this.roomManager
            )
        );

        // 2. Logic
        this.world.addSystem(new MovementSystem(this.world));
        this.world.addSystem(
            new PortalSystem(this.world, this.roomManager, this.availableRooms)
        );
        this.world.addSystem(new AnimationSystem(this.world));

        // 3. Visual (after logic, before render)
        this.world.addSystem(new SpriteSystem(this.world, this.camera));
        this.world.addSystem(new DepthSortSystem(this.world));
        this.world.addSystem(new PixelSnapSystem(this.world));
        this.world.addSystem(
            new CameraSystem(this.world, this.camera, this.roomManager)
        );

        // 4. Render (last)
        this.world.addSystem(
            new RenderSystem(this.world, this.renderer, this.scene, this.camera)
        );

        this.lastTime = performance.now();
        this.running = true;
        this.loop(this.lastTime);
    }

    public stop() {
        this.running = false;
    }

    private loop = (time: number) => {
        if (!this.running) return;
        requestAnimationFrame(this.loop);

        const dt = (time - this.lastTime) / 1000;
        this.lastTime = time;

        this.world.update(Math.min(dt, 0.1));
    }
}
