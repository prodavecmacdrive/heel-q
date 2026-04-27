/* ═══════════════════════════════════════════════════════════════════════
   LeftPanel — Toolbar (Select / Move / Rotate / Scale / Paint / Terrain)
   ═══════════════════════════════════════════════════════════════════════ */

export type ToolType = 'select' | 'translate' | 'rotate' | 'scale' | 'paint' | 'terrain' | 'door' | 'room' | 'round' | 'height-point' | 'height-line';

export class LeftPanel {
  private container: HTMLElement;
  private currentTool: ToolType = 'select';
  private onToolChange: (tool: ToolType) => void;

  constructor(container: HTMLElement, onToolChange: (tool: ToolType) => void) {
    this.container = container;
    this.onToolChange = onToolChange;
    this.render();
    this.setupKeyboardShortcuts();
  }

  public setMode(mode: 'world' | 'room' | 'height') {
    const worldTools   = ['tool-btn-door', 'tool-btn-room', 'tool-btn-round', 'tool-btn-translate'];
    const roomTools    = ['tool-btn-translate', 'tool-btn-rotate', 'tool-btn-scale'];
    const heightTools  = ['tool-btn-height-point', 'tool-btn-height-line'];

    worldTools.forEach(id => {
      const btn = this.container.querySelector(`#${id}`) as HTMLElement;
      if (btn) btn.style.display = mode === 'world' ? 'flex' : 'none';
    });

    roomTools.forEach(id => {
      const btn = this.container.querySelector(`#${id}`) as HTMLElement;
      if (btn && mode !== 'world') {
        btn.style.display = mode === 'room' ? 'flex' : 'none';
      }
    });

    heightTools.forEach(id => {
      const btn = this.container.querySelector(`#${id}`) as HTMLElement;
      if (btn) btn.style.display = mode === 'height' ? 'flex' : 'none';
    });

    // Auto-select the canonical tool for the new mode
    if (mode === 'height') {
      this.setTool('height-point');
    } else if (mode === 'room') {
      this.setTool('select');
    } else if (mode === 'world') {
      this.setTool('room');
    }
  }

  private render() {
    const tools: Array<{ key: ToolType; icon: string; tooltip: string; shortcut: string }> = [
      {
        key: 'select',
        tooltip: 'Select',
        shortcut: 'Q',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M5 3l14 8-6 2-4 6z"/>
        </svg>`,
      },
      {
        key: 'room',
        tooltip: 'Draw Room',
        shortcut: 'A',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 3h18v18H3zM9 3v18M15 3v18M3 9h18M3 15h18"/>
        </svg>`,
      },
      {
        key: 'door',
        tooltip: 'Draw Door',
        shortcut: 'D',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 21V3h14v18M3 21h18M11 12h2"/>
        </svg>`,
      },
      {
        key: 'round',
        tooltip: 'Round Corner',
        shortcut: 'F',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 20 Q4 4 20 4"/>
          <circle cx="4" cy="20" r="1.5" fill="currentColor"/>
          <circle cx="20" cy="4" r="1.5" fill="currentColor"/>
          <circle cx="4" cy="11" r="1" fill="currentColor" opacity="0.5"/>
        </svg>`,
      },
      {
        key: 'translate',
        tooltip: 'Move',
        shortcut: 'W',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2v20M2 12h20M5 5l7-3 7 3M5 19l7 3 7-3M2 12l3-7M2 12l3 7M22 12l-3-7M22 12l-3 7"/>
          <path d="M12 2l-3 3h6zM12 22l-3-3h6zM2 12l3-3v6zM22 12l-3-3v6z" fill="currentColor"/>
        </svg>`,
      },
      {
        key: 'rotate',
        tooltip: 'Rotate',
        shortcut: 'E',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
          <path d="M21 3v5h-5"/>
        </svg>`,
      },
      {
        key: 'scale',
        tooltip: 'Scale',
        shortcut: 'R',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="4" y="4" width="6" height="6" rx="1"/>
          <rect x="14" y="14" width="6" height="6" rx="1"/>
          <path d="M14 10l-4 4"/>
        </svg>`,
      },
    ];

    const heightTools: Array<{ key: ToolType; icon: string; tooltip: string; shortcut: string }> = [
      {
        key: 'height-point',
        tooltip: 'Elevation Node — click to place a hill/pit control point',
        shortcut: 'H',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="10" r="3"/>
          <path d="M12 2v2M12 18v4M4 10H2M22 10h-2"/>
          <path d="M6 6l1.5 1.5M18 6l-1.5 1.5M6 14l1.5-1.5"/>
          <ellipse cx="12" cy="10" rx="6" ry="2" opacity="0.35"/>
        </svg>`,
      },
      {
        key: 'height-line',
        tooltip: 'Elevation Ridge/Trench — click waypoints, Enter to finalize',
        shortcut: 'L',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 18 Q8 6 12 10 Q16 14 21 4"/>
          <circle cx="3" cy="18" r="1.5" fill="currentColor"/>
          <circle cx="12" cy="10" r="1.5" fill="currentColor"/>
          <circle cx="21" cy="4" r="1.5" fill="currentColor"/>
        </svg>`,
      },
    ];

    const stubTools: Array<{ key: ToolType; icon: string; tooltip: string; shortcut: string }> = [
      {
        key: 'paint',
        tooltip: 'Paint (Coming Soon)',
        shortcut: 'B',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 3H5a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z"/>
          <path d="M12 9v12"/>
          <circle cx="12" cy="21" r="1"/>
        </svg>`,
      },
    ];

    this.container.innerHTML = `
      ${tools.map(t => `
        <button class="tool-btn ${t.key === this.currentTool ? 'active' : ''}"
                data-tool="${t.key}" data-tooltip="${t.tooltip}" data-shortcut="${t.shortcut}"
                id="tool-btn-${t.key}">
          ${t.icon}
        </button>
      `).join('')}
      <div class="tool-separator"></div>
      ${heightTools.map(t => `
        <button class="tool-btn ${t.key === this.currentTool ? 'active' : ''}"
                data-tool="${t.key}" data-tooltip="${t.tooltip}" data-shortcut="${t.shortcut}"
                style="display:none" id="tool-btn-${t.key}">
          ${t.icon}
        </button>
      `).join('')}
      ${stubTools.map(t => `
        <button class="tool-btn" data-tool="${t.key}" data-tooltip="${t.tooltip}" data-shortcut="${t.shortcut}"
                style="opacity:0.4" id="tool-btn-${t.key}">
          ${t.icon}
        </button>
      `).join('')}
    `;

    // Bind click handlers
    this.container.querySelectorAll('.tool-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tool = (btn as HTMLElement).dataset.tool as ToolType;
        if (tool === 'paint') return; // stub
        this.setTool(tool);
      });
    });
  }

  public setTool(tool: ToolType) {
    this.currentTool = tool;

    this.container.querySelectorAll('.tool-btn').forEach((btn) => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.tool === tool);
    });

    this.onToolChange(tool);
  }

  public getTool(): ToolType {
    return this.currentTool;
  }

  private setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Don't trigger when typing in inputs
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;

      switch (e.key.toLowerCase()) {
        case 'q': this.setTool('select'); break;
        case 'a': this.setTool('room'); break;
        case 'w': this.setTool('translate'); break;
        case 'e': this.setTool('rotate'); break;
        case 'r': this.setTool('scale'); break;
        case 'd': this.setTool('door'); break;
        case 'f': this.setTool('round'); break;
        case 'h': this.setTool('height-point'); break;
        case 'l': this.setTool('height-line'); break;
      }
    });
  }
}
