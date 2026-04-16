/* ═══════════════════════════════════════════════════════════════════════
   MenuBar — File menu + room info
   ═══════════════════════════════════════════════════════════════════════ */

export type MenuAction = 'new' | 'save' | 'load' | 'export';

export class MenuBar {
  private container: HTMLElement;
  private onAction: (action: MenuAction) => void;

  constructor(container: HTMLElement, onAction: (action: MenuAction) => void) {
    this.container = container;
    this.onAction = onAction;
    this.render();
  }

  private render() {
    this.container.innerHTML = `
      <div class="menu-logo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2L2 7l10 5 10-5-10-5z"/>
          <path d="M2 17l10 5 10-5"/>
          <path d="M2 12l10 5 10-5"/>
        </svg>
        Heel Quest
      </div>
      <button class="menu-btn" data-action="new" id="menu-new">New</button>
      <button class="menu-btn" data-action="save" id="menu-save">Save</button>
      <button class="menu-btn" data-action="load" id="menu-load">Load</button>
      <div class="menu-separator"></div>
      <button class="menu-btn primary" data-action="export" id="menu-export" style="background:var(--accent-blue);color:#fff;border:none;">⬇ Export JSON</button>
      <div class="menu-spacer"></div>
      <div class="menu-room-info">
        <span id="menu-room-label">Untitled Room</span>
        <span class="menu-room-id" id="menu-room-id">room_untitled</span>
      </div>
    `;

    // Bind click events
    this.container.querySelectorAll('.menu-btn[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = (btn as HTMLElement).dataset.action as MenuAction;
        this.onAction(action);
      });
    });
  }

  /** Update displayed room information */
  public updateRoomInfo(name: string, id: string) {
    const label = document.getElementById('menu-room-label');
    const idEl = document.getElementById('menu-room-id');
    if (label) label.textContent = name;
    if (idEl) idEl.textContent = id;
  }
}
