// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { BackupDestination, BackupLocation } from "./destination.js";

export class LocalBackupDestination implements BackupDestination {
  readonly id = "local";

  constructor(private readonly dir: string) {}

  async put(name: string, filePath: string): Promise<BackupLocation> {
    const dest = this.resolve(name);
    mkdirSync(this.dir, { recursive: true });
    copyFileSync(filePath, dest);
    return { location: dest };
  }

  async get(name: string, destPath: string): Promise<void> {
    copyFileSync(this.resolve(name), destPath);
  }

  private resolve(name: string): string {
    const base = path.basename(name);
    if (base !== name || base.length === 0 || base === "." || base === "..") {
      throw new Error("Backup name is invalid");
    }
    const root = path.resolve(this.dir);
    const full = path.resolve(root, base);
    if (!full.startsWith(`${root}${path.sep}`)) throw new Error("Backup name is invalid");
    return full;
  }
}
