import type { Request, Response, NextFunction } from "express";
import {
  isPilotMode,
  PILOT_DISABLED_CODE,
  PILOT_DISABLED_MESSAGE,
} from "../config/pilot";

/**
 * Returns 410 Gone with a clear JSON message when PILOT_MODE is on.
 * Mount in front of routers whose features are switched off for the school pilot
 * (money, escrow, wallet, cycles, disputes, chat, referrals, gamification).
 * Evaluated per request, so flipping PILOT_MODE needs only a restart.
 */
export function disabledInPilot(feature: string) {
  return (_req: Request, res: Response, next: NextFunction) => {
    if (!isPilotMode()) return next();
    return res.status(410).json({
      message: PILOT_DISABLED_MESSAGE,
      code: PILOT_DISABLED_CODE,
      feature,
      pilotMode: true,
    });
  };
}
