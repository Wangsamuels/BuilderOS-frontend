import type { Access, Membership } from "@/api/types";

/**
 * Cosmetic only. These helpers decide which buttons and menu items to show from the access object the API
 * returned. They never grant anything: every request is re-checked on chain by the server and can still 403.
 */
const has = (a: Access, ...scopes: string[]) => a.scopes.some((s) => scopes.includes(s));
export const isAdmin = (a: Access) => a.founder || a.admin;
export const can = {
  work: (a: Access) => isAdmin(a) || has(a, "builder", "code"),
  approve: (a: Access) => isAdmin(a) || has(a, "approve"),
  money: (a: Access) => isAdmin(a) || has(a, "view", "approve"),
  admin: isAdmin,
  founder: (a: Access) => a.founder,
};
export const roleOf = (m: Pick<Membership, "isFounder" | "admin">) => (m.isFounder ? "founder" : m.admin ? "admin" : "member");
export const accessOf = (m: Membership): Access => ({ founder: m.isFounder, admin: m.admin || m.isFounder, scopes: m.scopes, departmentId: m.departmentId });
export const NO_ACCESS: Access = { founder: false, admin: false, scopes: [], departmentId: null };
