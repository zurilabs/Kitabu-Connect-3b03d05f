import { Router } from "express";
import type { Request, Response } from "express";
import { authenticateToken } from "../middleware/auth.middleware";
import { consentService } from "../services/consent.service";

const router = Router();

/** GET /api/consent - current consent status for the signed-in parent */
router.get("/", authenticateToken, async (req: Request, res: Response) => {
  try {
    const result = await consentService.getStatus(req.user!.id);
    if (!result.success) return res.status(404).json({ message: result.message });
    return res.status(200).json({ consent: result.consent });
  } catch (error) {
    console.error("[Consent] status error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

/** POST /api/consent - record consent (body: { accepted: true }) */
router.post("/", authenticateToken, async (req: Request, res: Response) => {
  try {
    if (req.body?.accepted !== true) {
      return res.status(400).json({ message: "Consent must be explicitly accepted." });
    }
    const result = await consentService.giveConsent(req.user!.id);
    if (!result.success) return res.status(404).json({ message: result.message });
    return res.status(200).json({ consent: result.consent });
  } catch (error) {
    console.error("[Consent] give error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

/**
 * POST /api/consent/withdraw
 * Withdraw consent and delete this parent's child slots and wishlist links.
 */
router.post("/withdraw", authenticateToken, async (req: Request, res: Response) => {
  try {
    const result = await consentService.withdrawAndDeleteChildData(req.user!.id);
    return res.status(200).json({
      message: "Consent withdrawn. Your children's data has been deleted.",
      deletedChildSlots: result.deletedChildSlots,
      consent: result.consent,
    });
  } catch (error) {
    console.error("[Consent] withdraw error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
