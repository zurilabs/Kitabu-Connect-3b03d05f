import type { Request, Response, NextFunction } from "express";
import { CONSENT_VERSION } from "../config/pilot";
import { hasCurrentConsent } from "../pilot/consent";

/**
 * Blocks routes that store or use a child slot unless the parent has valid, current
 * consent on record (given, not withdrawn, and for the current notice version).
 * Must run after authenticateToken. Returns 403 with code CONSENT_REQUIRED.
 */
export function requireValidConsent(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ message: "Authentication required" });
  }
  if (!hasCurrentConsent(req.user, CONSENT_VERSION)) {
    return res.status(403).json({
      message: "Parental consent is required. Please read and accept the consent notice.",
      code: "CONSENT_REQUIRED",
    });
  }
  next();
}
