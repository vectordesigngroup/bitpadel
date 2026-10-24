import type { AppConfig } from "../config.js";
import { GpioDoorController, openOnoffPin } from "./gpio.js";
import { HttpDoorController } from "./http-relay.js";
import { MockDoorController } from "./mock.js";
import { SerialDoorController } from "./serial.js";
import type { DoorController } from "./types.js";

export function createDoorController(config: AppConfig): DoorController {
  switch (config.doorBackend) {
    case "mock":
      return new MockDoorController();
    case "http": {
      if (!config.doorHttp) throw new Error("HTTP door is not configured");
      return new HttpDoorController(config.doorHttp);
    }
    case "serial": {
      if (!config.doorSerial) throw new Error("Serial door is not configured");
      return new SerialDoorController(config.doorSerial.path);
    }
    case "gpio":
      throw new Error("DOOR_BACKEND=gpio is opened with openDoorController so the optional onoff module can load");
    default: {
      const unknown: never = config.doorBackend;
      throw new Error(`Unknown door backend: ${String(unknown)}`);
    }
  }
}

/** Startup path. GPIO loads the optional native module and fails here if it is missing. */
export async function openDoorController(config: AppConfig): Promise<DoorController> {
  switch (config.doorBackend) {
    case "mock":
    case "http":
    case "serial":
      return createDoorController(config);
    case "gpio": {
      if (!config.doorGpio) throw new Error("GPIO door is not configured");
      const pin = await openOnoffPin(config.doorGpio.pin);
      const door = new GpioDoorController(pin, config.doorGpio.activeHigh);
      await pin.write(config.doorGpio.activeHigh ? 0 : 1);
      return door;
    }
    default: {
      const unknown: never = config.doorBackend;
      throw new Error(`Unknown door backend: ${String(unknown)}`);
    }
  }
}
