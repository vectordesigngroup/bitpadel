import type { AppConfig } from "../config.js";
import { HttpDoorController } from "./http-relay.js";
import { MockDoorController } from "./mock.js";
import type { DoorController } from "./types.js";

export function createDoorController(config: AppConfig): DoorController {
  switch (config.doorBackend) {
    case "mock":
      return new MockDoorController();
    case "http": {
      if (!config.doorHttp) throw new Error("HTTP door is not configured");
      return new HttpDoorController(config.doorHttp);
    }
    default: {
      const unknown: never = config.doorBackend;
      throw new Error(`Unknown door backend: ${String(unknown)}`);
    }
  }
}
