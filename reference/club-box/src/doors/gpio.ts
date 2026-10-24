import type { DoorController, DoorPulse, DoorPulseResult } from "./types.js";

export interface GpioPin {
  write(value: 0 | 1): Promise<void>;
  unexport(): void;
}

/**
 * Pulses one GPIO pin, then returns it to the idle level.
 * There is no lock, hold-shut, or fire-release method.
 * Fire-alarm release stays on hardware this process cannot reach.
 * The optional `onoff` package is loaded only when a club selects GPIO.
 */
export class GpioDoorController implements DoorController {
  readonly name = "gpio" as const;

  constructor(
    private readonly pin: GpioPin,
    private readonly activeHigh: boolean,
  ) {}

  async pulseEntry(pulse: DoorPulse): Promise<DoorPulseResult> {
    const active: 0 | 1 = this.activeHigh ? 1 : 0;
    const idle: 0 | 1 = this.activeHigh ? 0 : 1;
    try {
      await this.pin.write(active);
      await delay(pulse.pulseMs);
      await this.pin.write(idle);
      return { ok: true };
    } catch {
      try {
        await this.pin.write(idle);
      } catch {
        /* The pin may already be gone. Egress hardware is unchanged. */
      }
      return { ok: false, reason: "unreachable" };
    }
  }
}

/**
 * Optional native module. It is not a dependency of the server image.
 * Importing it by a variable keeps TypeScript from requiring the package.
 */
export async function openOnoffPin(pinNumber: number): Promise<GpioPin> {
  const specifier = "onoff";
  let loaded: { Gpio?: GpioConstructor };
  try {
    loaded = (await import(specifier)) as { Gpio?: GpioConstructor };
  } catch {
    throw new Error(
      "DOOR_BACKEND=gpio needs the optional onoff package on the host that owns the pin. Install onoff there. This process never drives fire release.",
    );
  }
  const Gpio = loaded.Gpio;
  if (!Gpio) {
    throw new Error("DOOR_BACKEND=gpio needs the optional onoff package. The loaded module has no Gpio export.");
  }
  const gpio = new Gpio(pinNumber, "out");
  return {
    async write(value: 0 | 1): Promise<void> {
      gpio.writeSync(value);
    },
    unexport(): void {
      gpio.unexport();
    },
  };
}

type GpioConstructor = new (
  pin: number,
  direction: "out",
) => {
  writeSync(value: 0 | 1): void;
  unexport(): void;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
