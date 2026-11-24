import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { authenticateToken, checkOnboardingStatus } from "../middleware/auth.middleware";
import { reservationService } from "../services/reservation.service";
import { isPilotMode } from "../config/pilot";

const router = Router();

// Reservations exist in pilot mode only (adr-017). Outside the pilot the routes are not there.
router.use((_req, res, next) => {
  if (!isPilotMode()) return res.status(404).json({ message: "Not found" });
  next();
});

const reserveSchema = z.object({ listingId: z.number().int().positive() });

function parseId(req: Request): number | null {
  const id = parseInt(req.params.id);
  return Number.isNaN(id) ? null : id;
}

/** POST /api/reservations { listingId } */
router.post("/", authenticateToken, checkOnboardingStatus, async (req: Request, res: Response) => {
  try {
    const parsed = reserveSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "listingId is required" });
    const result = await reservationService.reserve(req.user!.id, parsed.data.listingId);
    if (!result.success) return res.status(result.status).json({ message: result.message });
    return res.status(201).json({ reservation: result.reservation });
  } catch (error) {
    console.error("[Reservations] reserve error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

/** GET /api/reservations?role=buyer|seller */
router.get("/", authenticateToken, async (req: Request, res: Response) => {
  try {
    const role = req.query.role === "seller" ? "seller" : "buyer";
    const reservations = await reservationService.list(req.user!.id, role);
    return res.json({ reservations });
  } catch (error) {
    console.error("[Reservations] list error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

/** GET /api/reservations/listing/:listingId  (the caller's own active reservation for that listing) */
router.get("/listing/:listingId", authenticateToken, async (req: Request, res: Response) => {
  try {
    const listingId = parseInt(req.params.listingId);
    if (Number.isNaN(listingId)) return res.json({ reservation: null });
    const reservation = await reservationService.getMyActiveForListing(req.user!.id, listingId);
    return res.json({ reservation });
  } catch (error) {
    console.error("[Reservations] listing lookup error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

/** POST /api/reservations/:id/cancel */
router.post("/:id/cancel", authenticateToken, async (req: Request, res: Response) => {
  try {
    const id = parseId(req);
    if (id === null) return res.status(404).json({ message: "Reservation not found" });
    const result = await reservationService.cancel(req.user!.id, id);
    if (!result.success) return res.status(result.status).json({ message: result.message });
    return res.json({ success: true });
  } catch (error) {
    console.error("[Reservations] cancel error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

/** POST /api/reservations/:id/confirm */
router.post("/:id/confirm", authenticateToken, async (req: Request, res: Response) => {
  try {
    const id = parseId(req);
    if (id === null) return res.status(404).json({ message: "Reservation not found" });
    const result = await reservationService.confirm(req.user!.id, id);
    if (!result.success) return res.status(result.status).json({ message: result.message });
    return res.json({ success: true, status: result.status });
  } catch (error) {
    console.error("[Reservations] confirm error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
