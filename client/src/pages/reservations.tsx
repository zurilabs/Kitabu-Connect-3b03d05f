import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CalendarDays } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PILOT_PAYMENT_NOTICE } from "@/config/pilot";
import { formatCollectionDay } from "@/components/pilot/ReserveSection";

interface Reservation {
  id: number;
  listingId: number;
  status: "reserved" | "cancelled" | "completed";
  role: "buyer" | "seller";
  bookTitle: string;
  photoUrl: string | null;
  otherPartyFirstName: string;
  collectionDay: { id: number; date: string; startTime: string; endTime: string; venueNote: string | null } | null;
  myConfirmed: boolean;
  otherConfirmed: boolean;
}

function ReservationList({ role }: { role: "buyer" | "seller" }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<number | null>(null);

  const { data, isLoading } = useQuery<{ reservations: Reservation[] }>({
    queryKey: ["reservations", role],
    queryFn: async () => {
      const response = await fetch(`/api/reservations?role=${role}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load reservations");
      return response.json();
    },
    staleTime: 0,
  });

  const act = async (id: number, action: "cancel" | "confirm") => {
    setBusyId(id);
    try {
      const response = await fetch(`/api/reservations/${id}/${action}`, {
        method: "POST",
        credentials: "include",
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.message || "Something went wrong");
      toast({
        title: action === "cancel" ? "Reservation cancelled" : json.status === "completed" ? "Handover complete" : "Handover confirmed",
      });
      await queryClient.invalidateQueries({ queryKey: ["reservations"] });
      await queryClient.invalidateQueries({ queryKey: ["book"] });
    } catch (error) {
      toast({
        title: "Could not complete that",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  if (isLoading) return <p className="py-8 text-center text-muted-foreground">Loading...</p>;
  const items = data?.reservations ?? [];
  if (items.length === 0) {
    return (
      <p className="py-8 text-center text-muted-foreground">
        {role === "buyer" ? "You have not reserved any books yet." : "None of your books have been reserved yet."}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((r) => (
        <Card key={r.id}>
          <CardContent className="space-y-3 p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link href={`/book/${r.listingId}`} className="font-medium hover:text-primary">
                {r.bookTitle}
              </Link>
              <Badge variant={r.status === "reserved" ? "default" : "secondary"}>
                {r.status === "reserved" ? "Reserved" : r.status === "completed" ? "Handed over" : "Cancelled"}
              </Badge>
            </div>
            <p className="text-muted-foreground">
              {role === "buyer" ? "Seller" : "Buyer"}: {r.otherPartyFirstName}
            </p>
            {r.collectionDay ? (
              <p className="flex items-start gap-1">
                <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                Hand over on {formatCollectionDay(r.collectionDay)}
                {r.collectionDay.venueNote ? `. ${r.collectionDay.venueNote}` : ""}
              </p>
            ) : (
              <p className="text-muted-foreground">No collection day is set yet.</p>
            )}
            {r.status === "reserved" && (
              <>
                <p className="text-xs text-muted-foreground">
                  {r.myConfirmed
                    ? "You confirmed. Waiting for the other parent."
                    : r.otherConfirmed
                    ? "The other parent confirmed. Please confirm once you have handed over."
                    : "Both parents confirm once the book has changed hands."}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={busyId === r.id || r.myConfirmed} onClick={() => act(r.id, "confirm")}>
                    Confirm handover
                  </Button>
                  <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => act(r.id, "cancel")}>
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function ReservationsPage() {
  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-display font-bold">My reservations</h1>
        <p className="text-muted-foreground">{PILOT_PAYMENT_NOTICE}</p>
      </div>
      <Tabs defaultValue="buyer">
        <TabsList>
          <TabsTrigger value="buyer">Reserving</TabsTrigger>
          <TabsTrigger value="seller">Reserved from me</TabsTrigger>
        </TabsList>
        <TabsContent value="buyer">
          <ReservationList role="buyer" />
        </TabsContent>
        <TabsContent value="seller">
          <ReservationList role="seller" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
