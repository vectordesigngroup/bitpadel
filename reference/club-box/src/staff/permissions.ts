export const STAFF_ROLES = ["owner", "manager", "front-desk", "coach"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export type Permission =
  | "admin"
  | "desk"
  | "staff.manage"
  | "staff.assign-owner";

const ALL: readonly Permission[] = ["admin", "desk", "staff.manage", "staff.assign-owner"];
const MANAGER: readonly Permission[] = ["admin", "desk", "staff.manage"];
const DESK: readonly Permission[] = ["desk"];

export function permissionsFor(role: StaffRole): readonly Permission[] {
  switch (role) {
    case "owner":
      return ALL;
    case "manager":
      return MANAGER;
    case "front-desk":
    case "coach":
      return DESK;
    default: {
      const unknown: never = role;
      throw new Error(`Unknown staff role: ${String(unknown)}`);
    }
  }
}

export function roleHas(role: StaffRole, permission: Permission): boolean {
  return permissionsFor(role).includes(permission);
}

export function isStaffRole(value: string): value is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(value);
}
