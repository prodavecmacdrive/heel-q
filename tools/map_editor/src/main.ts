/* ═══════════════════════════════════════════════════════════════════════
   Map Editor — Entry Point
   ═══════════════════════════════════════════════════════════════════════ */

import { EditorApp } from './EditorApp';

const app = new EditorApp();

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => app.init());
} else {
  app.init();
}
