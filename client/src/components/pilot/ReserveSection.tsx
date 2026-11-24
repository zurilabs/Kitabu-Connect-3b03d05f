import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CalendarDays } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { PILOT_PAYMENT_NOTICE } from "@/config/pilot";

interface CollectionDay {
  id: number;
  date: string;
  startTime: string;
  endTime: string;
  venueNote: string | null;
}

export function formatCollectionDay(day: CollectionDay) {
  const label = new Date(`${day.date}T00:00:00`).toLocaleDateString("en-KE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return `${label}, ${day.startTime} to ${day.endTime}`;
}

interface ReserveSectionProps {
  listing: {
    id: number;
    sellerId: string;
    schoolId?: string | null;
    listingStatus: string;
    listingType?: string | null;
  };
}

/**
 * Pilot "Reserve for collection day" (adr-017). Shown for sell listings that are not the
 * viewer's own. No phone, chat or payment: the parents meet at the school collection day.
 */
export function ReserveSection({ listing }: ReserveSectionProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const isOwn = !!user && user.id === listing.sellerId;
  const enabled = !!user && !isOwn && listing.listingType !== "swap";

  const { data: mine } = useQuery<{ reservation: { id: number; collectionDay: CollectionDay | null } | null }>({
    queryKey: ["reservation-for-listing", listing.id],
    enabled,
    queryFn: async () => {
      const response = await fetch(`/api/reservations/listing/${listing.id}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load reservation");
      return response.json();
    },
    staleTime: 0,
  });

  const { data: days } = useQuery<{ collectionDays: CollectionDay[] }>({
    queryKey: ["collection-days", listing.schoolId],
    enabled: enabled && !!listing.schoolId,
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

  if (listing.listingType === "swap" || isOwn) return null;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["reservation-for-listing", listing.id] });
    await queryClient.invalidateQueries({ queryKey: ["book", listing.id] });
    await queryClient.invalidateQueries({ queryKey: ["reservations"] });
  };

  const call = async (path: string, body?: unknown) => {
    setBusy(true);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : {},
        credentials: "include",
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.message || "Something went wrong");
      await refresh();
      return true;
    } catch (error) {
      toast({
        title: "Could not complete that",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const nextDay = days?.collectionDays?.[0];
  const myDay = mine?.reservation?.collectionDay ?? null;

  if (mine?.reservation) {
    return (
      <div className="space-y-3 rounded-lg border border-green-300 bg-green-50 p-3 text-sm dark:bg-green-950/30">
        <p className="font-medium">
          {myDay
            ? `Reserved for you: hand over on ${formatCollectionDay(myDay)}`
            : "Reserved for you. We will tell you when a collection day is set."}
        </p>
        <p className="text-muted-foreground">{PILOT_PAYMENT_NOTICE}</p>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => call(`/api/reservations/${mine.reservation!.id}/cancel`)}
        >
          Cancel reservation
        </Button>
      </div>
    );
  }

  if (listing.listingStatus === "reserved") {
    return <Badge variant="secondary">Reserved</Badge>;
  }

  if (listing.listingStatus !== "active") return null;

  return (
    <div className="space-y-3 text-sm">
      {nextDay && (
        <div className="flex items-start gap-2 rounded-lg bg-muted p-3">
          <CalendarDays className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
          <div>
            <div className="font-medium">Collection day at this school</div>
            <div className="text-muted-foreground">{formatCollectionDay(nextDay)}</div>
          </div>
        </div>
      )}
      <p className="text-muted-foreground">{PILOT_PAYMENT_NOTICE}</p>
      <Button
        className="w-full h-12 text-lg font-semibold"
        disabled={busy || !user}
        onClick={() => call("/api/reservations", { listingId: listing.id })}
      >
        Reserve for collection day
      </Button>
      {!user && <p className="text-xs text-muted-foreground">Log in to reserve this book.</p>}
    </div>
  );
}
