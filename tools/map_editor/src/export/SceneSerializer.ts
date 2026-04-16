/* ═══════════════════════════════════════════════════════════════════════
   SceneSerializer — converts editor world ↔ JSON
   ═══════════════════════════════════════════════════════════════════════ */

import type { WorldProject } from '../types/scene';

const SCHEMA_VERSION = '1.0.0';

export class SceneSerializer {

  /** Serialize world to JSON string (pretty-printed) */
  public serialize(world: WorldProject): string {
    const output: WorldProject = {
      ...world,
      version: SCHEMA_VERSION,
    };
    return JSON.stringify(output, null, 2);
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
    const json = this.serialize(world);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${world.projectId}.json`;
    a.click();

    URL.revokeObjectURL(url);
  }

  /** Save to localStorage under a key and sync to engine via Vite plugin */
  public async saveToStorage(world: WorldProject, key?: string) {
    const json = this.serialize(world);
    const storageKey = key || `map_editor_world_${world.projectId}`;
    localStorage.setItem(storageKey, json);
    localStorage.setItem('map_editor_last_world', storageKey);

    // Sync to engine
    try {
      await fetch('/api/save-world', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: json
      });
      console.log('Successfully synced world to engine data folder.');
    } catch (e) {
      console.error('Failed to sync to engine:', e);
    }
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
