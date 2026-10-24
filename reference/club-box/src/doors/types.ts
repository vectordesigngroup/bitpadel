export type DoorBackendName = "mock" | "http";

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
 * or life-safety command. Egress stays on hardware this software cannot reach.
 */
export interface DoorController {
  readonly name: DoorBackendName;
  pulseEntry(pulse: DoorPulse): Promise<DoorPulseResult>;
}
