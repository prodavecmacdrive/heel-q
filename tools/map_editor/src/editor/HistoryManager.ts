/* ═══════════════════════════════════════════════════════════════════════
   HistoryManager — Snapshot-based undo / redo
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Manages a capped stack of JSON snapshots.
 * Call push(snapshot) BEFORE a destructive action to save the state that
 * should be restored on Undo.  undo()/redo() return the snapshot to restore.
 */
export class HistoryManager {
  private past: string[]   = [];
  private future: string[] = [];
  private readonly limit: number;

  constructor(limit = 60) {
    this.limit = limit;
  }

  /** Save the CURRENT state before a change so it can be restored. */
  push(snapshot: string): void {
    this.past.push(snapshot);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];   // branching clears the redo stack
  }

  /**
   * Undo: pass the current snapshot, get back the previous one.
   * Returns null when there is nothing to undo.
   */
  undo(current: string): string | null {
    if (this.past.length === 0) return null;
    this.future.push(current);
    return this.past.pop()!;
  }

  /**
   * Redo: pass the current snapshot, get back the next one.
   * Returns null when there is nothing to redo.
   */
  redo(current: string): string | null {
    if (this.future.length === 0) return null;
    this.past.push(current);
    return this.future.pop()!;
  }

  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }

  clear(): void { this.past = []; this.future = []; }
}
