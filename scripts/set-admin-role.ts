/**
 * Grant or revoke the ADMIN role for an existing account (adr-018).
 *
 * Admin rights are never derived from an email address. This script is the only way to
 * change them, and it needs direct database access (DATABASE_URL or DB_* env vars).
 *
 * Usage:
 *   npx tsx scripts/set-admin-role.ts grant someone@example.com
 *   npx tsx scripts/set-admin-role.ts revoke someone@example.com
 *   npx tsx scripts/set-admin-role.ts list
 */
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { users } from "../server/db/schema";

async function main() {
  const [action, rawEmail] = process.argv.slice(2);

  if (action === "list") {
    const admins = await db
      .select({ email: users.email, fullName: users.fullName })
      .from(users)
      .where(eq(users.role, "ADMIN"));
    console.log(admins.length ? admins.map((a) => `${a.email} (${a.fullName ?? "no name"})`).join("\n") : "No admins.");
    return;
  }

  if ((action !== "grant" && action !== "revoke") || !rawEmail) {
    console.error("Usage: npx tsx scripts/set-admin-role.ts <grant|revoke> <email> | list");
    process.exitCode = 1;
    return;
  }

  const email = rawEmail.toLowerCase().trim();
  const [user] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.email, email)).limit(1);
  if (!user) {
    console.error(`No account with email ${email}. The person must sign in once first.`);
    process.exitCode = 1;
    return;
  }

  const role = action === "grant" ? "ADMIN" : "PARENT";
  await db.update(users).set({ role }).where(eq(users.id, user.id));
  console.log(`${email}: ${user.role} -> ${role}`);
}

main()
  .catch((error) => {
    console.error("set-admin-role failed:", error);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
