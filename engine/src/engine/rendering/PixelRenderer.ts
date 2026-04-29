import * as THREE from 'three';
import { VIRTUAL_WIDTH, VIRTUAL_HEIGHT } from '../constants';

const TARGET_ASPECT = VIRTUAL_WIDTH / VIRTUAL_HEIGHT; // 16:9

export class PixelRenderer {
    private renderer: THREE.WebGLRenderer;
    private renderTarget: THREE.WebGLRenderTarget;

    // For rendering the final upscale
    private orthoCamera: THREE.OrthographicCamera;
    private postScene: THREE.Scene;
    private quad: THREE.Mesh;

    // --- Added for multi-camera support ---
    private thumbnailTarget: THREE.WebGLRenderTarget;
    private thumbnailQuad: THREE.Mesh;
    private helperCamera: THREE.PerspectiveCamera; // Temporary camera for internal room-mapping

    // Letterbox viewport tracking (exposed for input coordinate mapping)
    public viewportX: number = 0;
    public viewportY: number = 0;
    public viewportWidth: number = VIRTUAL_WIDTH;
    public viewportHeight: number = VIRTUAL_HEIGHT;

    constructor(private canvas: HTMLCanvasElement) {
        // Core retro setting: no antialiasing
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: false,
            powerPreference: 'high-performance'
        });
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        // Disable auto clearing so we can control it per-pass
        this.renderer.autoClear = false;

        // --- 1. Setup the Low-Res Render Target (locked at virtual resolution) ---
        this.renderTarget = new THREE.WebGLRenderTarget(VIRTUAL_WIDTH, VIRTUAL_HEIGHT, {
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
            format: THREE.RGBAFormat,
            colorSpace: THREE.SRGBColorSpace,
            depthTexture: new THREE.DepthTexture(VIRTUAL_WIDTH, VIRTUAL_HEIGHT)
        });

        // --- 2. Setup the Screen Quad (for upscaling) ---
        this.orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.postScene = new THREE.Scene();

        const planeMaterial = new THREE.MeshBasicMaterial({
            map: this.renderTarget.texture
        });
        const planeGeometry = new THREE.PlaneGeometry(2, 2);
        this.quad = new THREE.Mesh(planeGeometry, planeMaterial);
        this.postScene.add(this.quad);

        // --- Multi-camera thumbnails (internal small buffer) ---
        this.thumbnailTarget = new THREE.WebGLRenderTarget(128, 72, {
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
            format: THREE.RGBAFormat,
            colorSpace: THREE.SRGBColorSpace,
        });
        const thumbMat = new THREE.MeshBasicMaterial({ map: this.thumbnailTarget.texture });
        this.thumbnailQuad = new THREE.Mesh(planeGeometry, thumbMat);
        this.helperCamera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100);

        // Bind resize event
        window.addEventListener('resize', this.onWindowResize.bind(this));
        this.onWindowResize(); // Force initial sizing
    }

    /**
     * Strict Letterbox / Pillarbox resize handler.
     * The WebGLRenderer's pixel buffer covers the full window, but
     * the viewport scissor is constrained to the largest 16:9 rect
     * that fits inside the window.  The canvas element is always
     * full-window so the black bars come from the cleared background.
     */
    private onWindowResize() {
        const winW = window.innerWidth;
        const winH = window.innerHeight;

        // The renderer buffer always matches the window
        this.renderer.setSize(winW, winH);
        // Make the canvas fill the whole window (black bars are the cleared bg)
        this.canvas.style.width = winW + 'px';
        this.canvas.style.height = winH + 'px';

        // Calculate largest 16:9 rect inside window
        const windowAspect = winW / winH;
        let vpW: number, vpH: number, vpX: number, vpY: number;

        if (windowAspect > TARGET_ASPECT) {
            // Window is wider than 16:9 → pillarbox (black bars on sides)
            vpH = winH;
            vpW = Math.floor(winH * TARGET_ASPECT);
            vpX = Math.floor((winW - vpW) / 2);
            vpY = 0;
        } else {
            // Window is taller than 16:9 → letterbox (black bars top/bottom)
            vpW = winW;
            vpH = Math.floor(winW / TARGET_ASPECT);
            vpX = 0;
            vpY = Math.floor((winH - vpH) / 2);
        }

        this.viewportX = vpX;
        this.viewportY = vpY;
        this.viewportWidth = vpW;
        this.viewportHeight = vpH;
    }

    public render(scene: THREE.Scene, camera: THREE.Camera) {
        // Step 1: Render 3D scene into low-resolution render target
        this.renderer.setRenderTarget(this.renderTarget);
        this.renderer.clear(true, true, true);
        this.renderer.render(scene, camera);

        // Step 2: Upscale onto fullscreen quad, but only inside the letterbox viewport
        this.renderer.setRenderTarget(null);
        // Clear entire screen to black (the letterbox bars)
        this.renderer.setClearColor(0x000000, 1);
        this.renderer.clear(true, true, true);

        // Constrain the viewport/scissor to the calculated 16:9 rect
        this.renderer.setViewport(this.viewportX, this.viewportY, this.viewportWidth, this.viewportHeight);
        this.renderer.setScissorTest(true);
        this.renderer.setScissor(this.viewportX, this.viewportY, this.viewportWidth, this.viewportHeight);

        this.renderer.render(this.postScene, this.orthoCamera);

        // Reset scissor
        this.renderer.setScissorTest(false);
    }

    /**
     * Helper to check if a pixel coordinate is inside a rectangular area.
     */
    public isInsideRect(x: number, y: number, rectX: number, rectY: number, thumbW: number, thumbH: number): boolean {
        // Convert screen coordinates to local viewport coordinates
        // Mouse Y is top-down, but Three.js viewport Y is bottom-up (mostly)
        // However, WebGL coordinates for mouse handling usually need to account for DOM height.
        return x >= rectX && x <= rectX + thumbW && y >= rectY && y <= rectY + thumbH;
    }

    /**
     * Specialized multi-pass thumbnail renderer for small camera windows.
     * Renders the provided scene from multiple camera states into a shared thumbnail target,
     * then composites them onto the screen.
     */
    public renderThumbnails(scene: THREE.Scene, cameras: { position: THREE.Vector3, rotation: THREE.Euler, fov: number }[], activeIndex: number) {
        if (cameras.length <= 1) return;

        const thumbWidth = Math.floor(this.viewportWidth * 0.15); // 15% of viewport width
        const thumbHeight = Math.floor(thumbWidth / (16 / 9));
        const padding = 10;

        for (let i = 0; i < cameras.length; i++) {
            // Skip the active one as it's the main view
            if (i === activeIndex) continue;

            // 1. Render thumbnail view to small target
            this.helperCamera.position.copy(cameras[i].position);
            this.helperCamera.rotation.copy(cameras[i].rotation);
            this.helperCamera.fov = cameras[i].fov;
            this.helperCamera.updateProjectionMatrix();

            this.renderer.setRenderTarget(this.thumbnailTarget);
            this.renderer.clear(true, true, true);
            this.renderer.render(scene, this.helperCamera);

            // 2. Render from target to screen at specific location
            this.renderer.setRenderTarget(null);
            
            // Layout: bottom right, stacked vertically
            const x = this.viewportX + this.viewportWidth - thumbWidth - padding;
            const y = this.viewportY + padding + (i > activeIndex ? i - 1 : i) * (thumbHeight + padding);

            this.renderer.setViewport(x, y, thumbWidth, thumbHeight);
            this.renderer.setScissor(x, y, thumbWidth, thumbHeight);
            this.renderer.setScissorTest(true);

            // Using thumbnailQuad (which maps thumbnailTarget.texture)
            this.renderer.render(this.thumbnailQuad, this.orthoCamera);
            this.renderer.setScissorTest(false);
        }
    }

    public getDomElement(): HTMLCanvasElement {
        return this.renderer.domElement;
    }
}
