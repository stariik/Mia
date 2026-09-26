import AsyncStorage, {
  type AsyncStorage as Storage,
} from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';

import { isExpoGo } from './runtime';

// Key-value storage for the whole app. Native builds use async-storage v3.
// Expo Go ships only async-storage v2's native module, which v3 can't talk to,
// so there the same interface is backed by one JSON file instead. Downgrading
// to v2 isn't an option: v3 migrated installed users' data to a new database.

function createFileStorage(): Storage {
  const file = new File(Paths.document, 'expo-go-storage.json');
  let data: Record<string, string> | null = null;
  let writes: Promise<void> = Promise.resolve();

  async function load(): Promise<Record<string, string>> {
    if (data) return data;
    try {
      data = file.exists ? JSON.parse(await file.text()) : {};
    } catch {
      data = {};
    }
    return data!;
  }

  function save(): Promise<void> {
    writes = writes.then(() => file.write(JSON.stringify(data ?? {})));
    return writes;
  }

  return {
    async getItem(key) {
      return (await load())[key] ?? null;
    },
    async setItem(key, value) {
      (await load())[key] = value;
      await save();
    },
    async removeItem(key) {
      delete (await load())[key];
      await save();
    },
    async getMany(keys) {
      const all = await load();
      return Object.fromEntries(keys.map((k) => [k, all[k] ?? null]));
    },
    async setMany(entries) {
      Object.assign(await load(), entries);
      await save();
    },
    async removeMany(keys) {
      const all = await load();
      for (const k of keys) delete all[k];
      await save();
    },
    async getAllKeys() {
      return Object.keys(await load());
    },
    async clear() {
      data = {};
      await save();
    },
  };
}

export const storage: Storage = isExpoGo ? createFileStorage() : AsyncStorage;
