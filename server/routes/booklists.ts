import { Router } from "express";
import type { Request, Response } from "express";
import { authenticateToken, requireAdmin } from "../middleware/auth.middleware";
import { requireValidConsent } from "../middleware/consent.middleware";
import { booklistService } from "../services/booklist.service";
import {
  createBooklistSchema,
  bulkAddBooklistItemsSchema,
  createCollectionDaySchema,
  updateCollectionDaySchema,
} from "../db/schema/index.ts";
import { PILOT_BOOKLIST_YEAR } from "../config/pilot";
import { fromZodError } from "zod-validation-error";

const router = Router();

/* ============================================
   ADMIN-ONLY (role ADMIN, via requireAdmin)
============================================ */

/**
 * POST /api/booklists
 * Create (or reuse) a school booklist for a grade and year, optionally with items.
 * Body: { schoolId, grade, year, source?, items?: [...] }
 */
router.post("/", authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const validation = createBooklistSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ message: fromZodError(validation.error).message });
    }
    const result = await booklistService.createBooklist(req.user!.id, validation.data);
    if (!result.success) return res.status(result.status).json({ message: result.message });
    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    console.error("[Booklists] create error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

/**
 * POST /api/booklists/:id/items
 * Bulk add items (JSON array) to a booklist. Body: { items: [...] }
 */
router.post("/:id/items", authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const booklistId = parseInt(req.params.id);
    if (isNaN(booklistId)) return res.status(400).json({ message: "Invalid booklist ID" });

    const validation = bulkAddBooklistItemsSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ message: fromZodError(validation.error).message });
    }
    const result = await booklistService.addItems(booklistId, validation.data.items);
    if (!result.success) return res.status(result.status).json({ message: result.message });
    return res.status(201).json(result);
  } catch (error) {
    console.error("[Booklists] add items error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

/* ============================================
   PARENT / PUBLIC-TO-SIGNED-IN
============================================ */

/**
 * GET /api/booklists?schoolId=&grade=&year=
 * List booklists (with items).
 */
router.get("/", authenticateToken, async (req: Request, res: Response) => {
  try {
    const year = req.query.year ? parseInt(req.query.year as string) : undefined;
    const booklists = await booklistService.listBooklists({
      schoolId: (req.query.schoolId as string) || undefined,
      grade: (req.query.grade as string) || undefined,
      year: year && !isNaN(year) ? year : undefined,
    });
    return res.status(200).json({ booklists });
  } catch (error) {
    console.error("[Booklists] list error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

/**
 * GET /api/booklists/child/:childId?year=2027
 * "My child's booklist": reusable KICD-approved items, matched listings
 * (same school first, then same grade elsewhere) and the next collection day.
 * Read-only: it does not write. The wishlist build is POST /child/:childId/build.
 */
router.get("/child/:childId", authenticateToken, requireValidConsent, async (req: Request, res: Response) => {
  try {
    const childId = parseInt(req.params.childId);
    if (isNaN(childId)) return res.status(400).json({ message: "Invalid child ID" });
    const yearParam = req.query.year ? parseInt(req.query.year as string) : PILOT_BOOKLIST_YEAR;
    const year = isNaN(yearParam) ? PILOT_BOOKLIST_YEAR : yearParam;

    const result = await booklistService.getChildBooklistView(req.user!.id, childId, year);
    if (!result.success) return res.status(result.status).json({ message: result.message });
    return res.status(200).json(result);
  } catch (error) {
    console.error("[Booklists] child view error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

/**
 * POST /api/booklists/child/:childId/build?year=2027
 * Build the child slot's wishlist from the school booklist (idempotent; duplicates are no-ops).
 */
router.post("/child/:childId/build", authenticateToken, requireValidConsent, async (req: Request, res: Response) => {
  try {
    const childId = parseInt(req.params.childId);
    if (isNaN(childId)) return res.status(400).json({ message: "Invalid child ID" });
    const yearParam = req.query.year ? parseInt(req.query.year as string) : PILOT_BOOKLIST_YEAR;
    const year = isNaN(yearParam) ? PILOT_BOOKLIST_YEAR : yearParam;

    const result = await booklistService.buildWishlistForSlot(req.user!.id, childId, year);
    if (!result.success) return res.status(result.status).json({ message: result.message });
    return res.status(200).json({ success: true, created: result.created });
  } catch (error) {
    console.error("[Booklists] build error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

export default router;

/* ============================================
   COLLECTION DAYS (separate router, mounted at /api/collection-days)
============================================ */

export const collectionDaysRouter = Router();

/**
 * POST /api/collection-days   (admin only)
 * Body: { schoolId, date: "YYYY-MM-DD", startTime: "HH:MM", endTime: "HH:MM", venueNote?, status? }
 */
collectionDaysRouter.post("/", authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const validation = createCollectionDaySchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ message: fromZodError(validation.error).message });
    }
    const result = await booklistService.createCollectionDay(req.user!.id, validation.data);
    if (!result.success) return res.status(result.status).json({ message: result.message });
    return res.status(201).json(result);
  } catch (error) {
    console.error("[CollectionDays] create error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

/**
 * PATCH /api/collection-days/:id   (admin only)
 * Body: { status?, startTime?, endTime?, venueNote? }. Set status "cancelled" to cancel a day.
 */
collectionDaysRouter.patch("/:id", authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid collection day ID" });
    const validation = updateCollectionDaySchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ message: fromZodError(validation.error).message });
    }
    const result = await booklistService.updateCollectionDay(id, validation.data);
    if (!result.success) return res.status(result.status).json({ message: result.message });
    return res.status(200).json(result);
  } catch (error) {
    console.error("[CollectionDays] update error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

/**
 * GET /api/collection-days?schoolId=
 * Upcoming collection days (today or later, not cancelled).
 */
collectionDaysRouter.get("/", authenticateToken, async (req: Request, res: Response) => {
  try {
    const days = await booklistService.listUpcomingCollectionDays(
      (req.query.schoolId as string) || undefined
    );
    return res.status(200).json({ collectionDays: days });
  } catch (error) {
    console.error("[CollectionDays] list error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});
