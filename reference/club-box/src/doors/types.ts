export type DoorBackendName = "mock" | "http" | "gpio" | "serial";

export type DoorPulse = {
  area: string;
  requestId: string;
  pulseMs: number;
};

export type DoorPulseResult =
  | { ok: true }
  | { ok: false; reason: "unreachable" | "rejected" };

/**
 * Entry pulse only. Implementations must not add a lock, hold-shut, egress,
 * or life-safety command. `controlsEgress` and `controlsLifeSafety` stay false.
 * Fire-alarm release is wired at the hardware level. This software never
 * blocks egress and never pulses a fire-release circuit.
 */
export interface DoorController {
  readonly name: DoorBackendName;
  pulseEntry(pulse: DoorPulse): Promise<DoorPulseResult>;
}
