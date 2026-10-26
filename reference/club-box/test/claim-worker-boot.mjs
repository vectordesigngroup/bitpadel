// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

// Registers tsx inside the worker thread, then loads the TypeScript worker.
import { register } from "tsx/esm/api";

register();
await import("./claim-worker.ts");
