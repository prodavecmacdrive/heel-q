export class NavigationPanel {
    private container: HTMLElement;
    private cameraGrid!: HTMLElement;
    private currentScroll: number = 0;

    constructor(container: HTMLElement) {
        this.container = container;
        this.render();
    }

    private render() {
        this.container.innerHTML = `
            <div class="system-buttons">
                <button class="system-btn" title="Menu">☰</button>
                <button class="system-btn" title="Journal">NOTE</button>
                <button class="system-btn" title="Map">MAP</button>
            </div>
            <div class="camera-grid-container">
                <div class="camera-grid" id="camera-grid">
                    <!-- Camera previews will be injected here -->
                    <div class="camera-cell active"><div style="color:#555; font-size:10px; padding:5px;">CAM_01</div></div>
                    <div class="camera-cell"><div style="color:#555; font-size:10px; padding:5px;">CAM_02</div></div>
                    <div class="camera-cell"><div style="color:#555; font-size:10px; padding:5px;">CAM_03</div></div>
                    <div class="camera-cell"><div style="color:#555; font-size:10px; padding:5px;">CAM_04</div></div>
                </div>
            </div>
            <div class="camera-scroll-btns">
                <button class="system-btn" id="cam-up">UP</button>
                <button class="system-btn" id="cam-down">DOWN</button>
            </div>
        `;

        this.cameraGrid = this.container.querySelector('#camera-grid') as HTMLElement;
        this.setupEventListeners();
    }

    private setupEventListeners() {
        this.container.querySelector('#cam-up')?.addEventListener('click', () => this.scroll(-1));
        this.container.querySelector('#cam-down')?.addEventListener('click', () => this.scroll(1));
    }

    private scroll(direction: number) {
        const step = 100; // Pixels to scroll
        this.currentScroll += direction * step;

        // Basic clamping (should be improved based on content height)
        if (this.currentScroll > 0) this.currentScroll = 0;

        this.cameraGrid.style.transform = `translateY(${this.currentScroll}px)`;
    }
}
