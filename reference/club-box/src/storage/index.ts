import type { AppConfig } from "../config.js";
import { LocalObjectStorage } from "./local.js";
import { MemoryObjectStorage } from "./memory.js";
import type { ObjectStorage } from "./types.js";

export function createStorage(config: AppConfig): ObjectStorage {
  switch (config.storageBackend) {
    case "local":
      return new LocalObjectStorage(config.photoDir);
    case "memory":
      return new MemoryObjectStorage();
    default: {
      const unknown: never = config.storageBackend;
      throw new Error(`Unknown storage backend: ${String(unknown)}`);
    }
  }
}
