import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { CalendarDays, Share2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { PILOT_PAYMENT_NOTICE } from "@/config/pilot";
import { buildWhatsAppShareUrl } from "@/lib/whatsapp";
import { generateBookSlug } from "@/lib/utils";

interface ListingHandoverProps {
  listing: {
    id: number;
    title: string;
    classGrade?: string | null;
    schoolId?: string | null;
    originalRetailPrice?: string | number | null;
    listingType?: string | null;
  };
}

interface CollectionDay {
  id: number;
  date: string;
  startTime: string;
  endTime: string;
  venueNote: string | null;
}

/** Suggested used price band: 40 to 60% of list price, nearest KES 10 (mirrors server/pilot/listingRules.ts). */
function suggestedBand(listPrice: string | number | null | undefined) {
  const n = typeof listPrice === "string" ? parseFloat(listPrice) : listPrice;
  if (!n || !Number.isFinite(n) || n <= 0) return null;
  const r10 = (v: number) => Math.round(v / 10) * 10;
  return { min: r10(n * 0.4), max: r10(n * 0.6) };
}

/**
 * Pilot-mode replacement for checkout on the listing page (adr-016): the payment notice,
 * suggested used price, next collection day at the listing's school, and a WhatsApp share link.
 */
export function ListingHandover({ listing }: ListingHandoverProps) {
  const { user } = useAuth();

  const { data } = useQuery<{ collectionDays: CollectionDay[] }>({
    queryKey: ["collection-days", listing.schoolId],
    enabled: !!user && !!listing.schoolId,
    queryFn: async () => {
      const response = await fetch(
        `/api/collection-days?schoolId=${encodeURIComponent(listing.schoolId as string)}`,
        { credentials: "include" }
      );
      if (!response.ok) throw new Error("Failed to load collection days");
      return response.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const nextDay = data?.collectionDays?.[0];
  const band = suggestedBand(listing.originalRetailPrice);
  const listingUrl = `${window.location.origin}/book/${generateBookSlug(listing.title, listing.id)}`;

  return (
    <div className="space-y-3 text-sm">
      {band && listing.listingType !== "swap" && (
        <p className="text-muted-foreground">
          Suggested used price: KSh {band.min.toLocaleString()} to KSh {band.max.toLocaleString()}
        </p>
      )}

      <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">{PILOT_PAYMENT_NOTICE}</div>

      {nextDay && (
        <div className="flex items-start gap-2 rounded-lg bg-muted p-3">
          <CalendarDays className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
          <div>
            <div className="font-medium">Next collection day at this school</div>
            <div className="text-muted-foreground">
              {new Date(`${nextDay.date}T00:00:00`).toLocaleDateString("en-KE", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
              , {nextDay.startTime} to {nextDay.endTime}
              {nextDay.venueNote ? `. ${nextDay.venueNote}` : ""}
            </div>
          </div>
        </div>
      )}

      <Button asChild variant="outline" className="w-full">
        <a
          href={buildWhatsAppShareUrl({
            title: listing.title,
            listingUrl,
            grade: listing.classGrade,
          })}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Share2 className="w-4 h-4 mr-2" />
          Share on WhatsApp
        </a>
      </Button>
    </div>
  );
}
