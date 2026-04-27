/* ═══════════════════════════════════════════════════════════════════════
   terrainSampler — parametric terrain height computation

   Given a list of HeightModifiers (PointModifier | LineModifier), computes
   the accumulated Y displacement at any world XZ position using smooth
   power-falloff curves.  The same formula is used in the editor, engine,
   and any future tools to guarantee identical results everywhere.

   Semantics:
     entity.transform.position.y = offset ABOVE the terrain surface
     world Y = entity.position.y + computeTerrainHeight(modifiers, x, z)
   ═══════════════════════════════════════════════════════════════════════ */

import type { HeightModifier } from '../types/scene';

// ── Internal geometry helpers ─────────────────────────────────────────────

function distToSegment(
  px: number, pz: number,
  ax: number, az: number,
  bx: number, bz: number,
): number {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-10) {
    return Math.sqrt((px - ax) ** 2 + (pz - az) ** 2);
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
  return Math.sqrt((px - (ax + t * dx)) ** 2 + (pz - (az + t * dz)) ** 2);
}

function distToPolyline(
  px: number, pz: number,
  pts: ReadonlyArray<{ x: number; y: number }>,
): number {
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return Math.sqrt((px - pts[0].x) ** 2 + (pz - pts[0].y) ** 2);
  let min = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    min = Math.min(min, distToSegment(px, pz, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y));
  }
  return min;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Compute the cumulative terrain Y displacement at world position (wx, wz).
 *
 * All modifier contributions are summed additively.
 * Falloff formula per modifier:
 *   contribution = elevationOffset × max(0, 1 - dist/range)^sharpness
 *
 * @param modifiers   Array of PointModifier / LineModifier records
 * @param wx          World X coordinate
 * @param wz          World Z coordinate (note: Vec2.y maps to world Z)
 * @returns           Total Y offset in world units
 */
export function computeTerrainHeight(
  modifiers: ReadonlyArray<HeightModifier>,
  wx: number,
  wz: number,
): number {
  let total = 0;

  for (const mod of modifiers) {
    if (mod.type === 'point') {
      const dx   = wx - mod.position.x;
      const dz   = wz - mod.position.y; // Vec2.y → world Z
      const dist = Math.sqrt(dx * dx + dz * dz);
      const t    = Math.min(1, dist / Math.max(0.001, mod.radius));
      const w    = Math.pow(Math.max(0, 1 - t), Math.max(0.1, mod.sharpness));
      total += mod.elevationOffset * w;

    } else if (mod.type === 'line') {
      const dist = distToPolyline(wx, wz, mod.points);
      const t    = Math.min(1, dist / Math.max(0.001, mod.width));
      const w    = Math.pow(Math.max(0, 1 - t), Math.max(0.1, mod.sharpness));
      total += mod.elevationOffset * w;
    }
  }

  return total;
}
