/**
 * adr-018: admin rights come only from the stored role (granted with scripts/set-admin-role.ts),
 * never from the email address.
 */
export function isAdminUser(user: { role?: string | null } | null | undefined): boolean {
  return user?.role === "ADMIN";
}
