/* ═══════════════════════════════════════════════════════════════════════
   Asset path normalization — shared between engine and editor
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Normalize asset paths saved by the editor into relative engine paths.
 *
 * Handles:
 * - Windows backslashes: `\assets\sprites\foo.png` → `sprites/foo.png`
 * - Leading slashes: `/assets/textures/bar.jpg` → `textures/bar.jpg`
 * - Redundant `assets/` prefix: `assets/sprites/baz.png` → `sprites/baz.png`
 * - Already-relative paths pass through unchanged: `sprites/qux.png` → `sprites/qux.png`
 * - Empty/falsy input returns empty string
 *
 * @example
 * normalizeAssetPath('\\assets\\sprites\\customer.png') // → 'sprites/customer.png'
 * normalizeAssetPath('/assets/textures/door.jpg')       // → 'textures/door.jpg'
 * normalizeAssetPath('sprites/hero.png')                 // → 'sprites/hero.png'
 * normalizeAssetPath('')                                 // → ''
 */
export function normalizeAssetPath(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/\\/g, '/')     // backslashes → forward slashes
    .replace(/^\/+/, '')     // strip leading slashes
    .replace(/^assets\//, ''); // strip 'assets/' prefix
}
