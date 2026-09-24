// Durable JSON store for B canonical states: <dir>/<module>/<version-or-state_id>.json
// plus an append-only index.json that records save order (so "latest" is the
// last committed state, not the alphabetically last file).
import { mkdir, readFile } from "node:fs/promises";
import { atomicWrite } from "./safety.js";
import { join } from "node:path";
import { B_MODULES, type StatePersistence, type StrategyStore } from "./bOrchestrator.js";

function safe(key: string): string {
  if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(key)) throw new Error(`unsafe store key: ${key}`);
  // "%" is not allowed in keys, so "a:b" and "a_b" can never collide.
  return key.replace(/:/g, "%3A");
}

const isMissing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === "ENOENT";

export function filePersistence(dir: string): StatePersistence {
  const indexPath = join(dir, "index.json");
  const index = async (): Promise<string[]> => {
    let text: string;
    try {
      text = await readFile(indexPath, "utf8");
    } catch (e) {
      if (isMissing(e)) return [];
      throw e;
    }
    // A corrupt index must never look like an empty store (that would restart at v1.0).
    let keys: unknown;
    try {
      keys = JSON.parse(text);
    } catch {
      throw new Error(`strategy store index is corrupt: ${indexPath} — restore it from backup; do not delete it`);
    }
    if (!Array.isArray(keys) || !keys.every((k) => typeof k === "string")) throw new Error(`strategy store index is corrupt: ${indexPath}`);
    return keys;
  };
  const load = async (key: string) => {
    const path = join(dir, `${safe(key)}.json`);
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch (e) {
      if (isMissing(e)) return null;
      throw e;
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`strategy store file is corrupt: ${path}`);
    }
  };
  return {
    async save(state) {
      const key: string = state.state_id && !state.b01_canonical_version && state.module_versions ? state.state_id : state.version;
      await mkdir(dir, { recursive: true });
      await atomicWrite(join(dir, `${safe(key)}.json`), JSON.stringify(state, null, 2) + "\n");
      const keys = (await index()).filter((k) => k !== key);
      await atomicWrite(indexPath, JSON.stringify([...keys, key], null, 2) + "\n");
    },
    load,
    listVersions: index,
    listStates: index,
    async latest() {
      const keys = await index();
      return keys.length ? load(keys[keys.length - 1]!) : null;
    },
  };
}

export function fileStrategyStore(root: string): StrategyStore {
  return Object.fromEntries([...B_MODULES, "b12"].map((m) => [m, filePersistence(join(root, m))])) as StrategyStore;
}
