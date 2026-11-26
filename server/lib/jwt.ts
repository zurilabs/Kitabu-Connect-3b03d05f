import { SignJWT, jwtVerify } from "jose";
import { randomBytes } from "crypto";
import type { User } from "server/db/schema";

// adr-018: no hard-coded fallback. A known default secret would let anyone forge login tokens.
// Outside development the server refuses to start without a strong JWT_SECRET; in development a
// random per-process secret is used (sessions end when the server restarts).
function resolveJwtSecret(): string {
  const configured = process.env.JWT_SECRET;
  if (configured && configured.length >= 32) return configured;
  if (process.env.NODE_ENV === "development") {
    if (configured) console.warn("[JWT] JWT_SECRET is shorter than 32 characters (allowed in development only).");
    return configured || randomBytes(48).toString("hex");
  }
  throw new Error("JWT_SECRET must be set to at least 32 characters outside development.");
}

const JWT_SECRET = resolveJwtSecret();
const secret = new TextEncoder().encode(JWT_SECRET);

export interface JWTPayload {
  userId: string;
  phoneNumber: string;
  role: string;
}

export async function generateToken(user: User): Promise<string> {
  const token = await new SignJWT({
    userId: user.id,
    phoneNumber: user.phoneNumber,
    role: user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);

  return token;
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as JWTPayload;
  } catch (error) {
    return null;
  }
}
