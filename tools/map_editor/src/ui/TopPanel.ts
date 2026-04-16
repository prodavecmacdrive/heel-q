/* ═══════════════════════════════════════════════════════════════════════
   TopPanel — Mode Switcher (Room Map / Height Map / World Map)
   ═══════════════════════════════════════════════════════════════════════ */

export type EditorMode = 'room' | 'height' | 'world';

export class TopPanel {
  private container: HTMLElement;
  private currentMode: EditorMode = 'room';
  private onModeChange: (mode: EditorMode) => void;

  constructor(container: HTMLElement, onModeChange: (mode: EditorMode) => void) {
    this.container = container;
    this.onModeChange = onModeChange;
    this.render();
  }

  private render() {
    const modes: Array<{ key: EditorMode; label: string; icon: string }> = [
      {
        key: 'room',
        label: 'Room Map',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
          <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
        </svg>`
      },
      {
        key: 'height',
        label: 'Height Map',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M2 20L8.5 8 13 14 17 10 22 20z"/>
        </svg>`
      },
      {
        key: 'world',
        label: 'World Map',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10"/>
          <path d="M12 2a15.3 15.3 0 0 0-4 10 15.3 15.3 0 0 0 4 10"/>
        </svg>`
      },
    ];

    this.container.innerHTML = modes
      .map(
        (m) => `
        <button class="mode-btn ${m.key === this.currentMode ? 'active' : ''}"
                data-mode="${m.key}" id="mode-btn-${m.key}">
          ${m.icon}
          ${m.label}
        </button>`
      )
      .join('');

    this.container.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = (btn as HTMLElement).dataset.mode as EditorMode;
        this.setMode(mode);
      });
    });
  }

  public setMode(mode: EditorMode) {
    this.currentMode = mode;

    // Update button states
    this.container.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.mode === mode);
    });

    // Update viewport overlay
    const infoEl = document.getElementById('viewport-info');
    if (infoEl) {
      const labels: Record<EditorMode, string> = {
        room: 'Room Map Mode',
        height: 'Height Map Mode',
        world: 'World Map Mode',
      };
      infoEl.textContent = labels[mode];
    }

    this.onModeChange(mode);
  }

  public getMode(): EditorMode {
    return this.currentMode;
  }
}
