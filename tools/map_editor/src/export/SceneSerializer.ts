/* ═══════════════════════════════════════════════════════════════════════
   SceneSerializer — converts editor world ↔ JSON
   
   Persistence priority:
   - localStorage is always written (auto-save) with activeRoomId preserved
   - POST to /api/save-world syncs to engine; activeRoomId is stripped
   - If the POST fails, localStorage may be newer than the engine file
   ═══════════════════════════════════════════════════════════════════════ */

import type { WorldProject } from '../types/scene';

const SCHEMA_VERSION = '1.0.0';

export interface SaveResult {
  localSaved: boolean;
  engineSynced: boolean;
  timestamp: number;
  error?: string;
}

export class SceneSerializer {

  /** Serialize world to JSON string (pretty-printed) */
  public serialize(world: WorldProject): string {
    const output: WorldProject = {
      ...world,
      version: SCHEMA_VERSION,
    };
    return JSON.stringify(output, null, 2);
  }

  /** Serialize world for engine — strips editor-only fields */
  private serializeForEngine(world: WorldProject): string {
    const { activeRoomId, ...engineData } = { ...world, version: SCHEMA_VERSION };
    return JSON.stringify(engineData, null, 2);
  }

  /** Deserialize JSON string to WorldProject */
  public deserialize(json: string): WorldProject {
    const data = JSON.parse(json) as WorldProject;

    // Apply defaults for missing fields
    data.version = data.version || SCHEMA_VERSION;
    data.projectId = data.projectId || 'world';
    data.rooms = data.rooms || [];
    data.doors = data.doors || [];

    return data;
  }

  /** Download the JSON as a file */
  public downloadJSON(world: WorldProject) {
    const json = this.serializeForEngine(world);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${world.projectId}.json`;
    a.click();

    URL.revokeObjectURL(url);
  }

  /** Save to localStorage under a key and sync to engine via Vite plugin */
  public async saveToStorage(world: WorldProject, key?: string): Promise<SaveResult> {
    const timestamp = Date.now();
    const result: SaveResult = { localSaved: false, engineSynced: false, timestamp };

    // Save to localStorage (includes activeRoomId for editor state restore)
    const json = this.serialize(world);
    const storageKey = key || `map_editor_world_${world.projectId}`;
    localStorage.setItem(storageKey, json);
    localStorage.setItem('map_editor_last_world', storageKey);
    result.localSaved = true;

    // Sync to engine (strip editor-only fields)
    try {
      const engineJson = this.serializeForEngine(world);
      await fetch('/api/save-world', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: engineJson
      });
      console.log('Successfully synced world to engine data folder.');
      result.engineSynced = true;
    } catch (e) {
      console.error('Failed to sync to engine:', e);
      result.error = e instanceof Error ? e.message : 'Engine sync failed';
    }

    return result;
  }

  /** Load from localStorage */
  public loadFromStorage(key?: string): WorldProject | null {
    const storageKey = key || localStorage.getItem('map_editor_last_world') || '';
    if (!storageKey) return null;

    const json = localStorage.getItem(storageKey);
    if (!json) return null;

    try {
      return this.deserialize(json);
    } catch (e) {
      console.error('Failed to load world from storage:', e);
      return null;
    }
  }

  /** Import from a file input */
  public async importFromFile(file: File): Promise<WorldProject> {
    const text = await file.text();
    return this.deserialize(text);
  }
}
