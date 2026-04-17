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

    public getDomElement(): HTMLCanvasElement {
        return this.renderer.domElement;
    }
}
