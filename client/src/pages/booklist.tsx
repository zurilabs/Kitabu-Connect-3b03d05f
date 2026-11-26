import { useQuery } from "@tanstack/react-query";
import { ConsentBanner } from "@/components/pilot/ConsentBanner";
import { isConsentRequiredError, throwForFailedResponse } from "@/lib/consentError";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarDays, MapPin, Share2, BookOpen } from "lucide-react";
import { useActiveChild } from "@/contexts/ActiveChildContext";
import { PILOT_PAYMENT_NOTICE } from "@/config/pilot";
import { buildWhatsAppShareUrl } from "@/lib/whatsapp";
import { generateBookSlug } from "@/lib/utils";

const BOOKLIST_YEAR = 2027;

interface BooklistMatch {
  tier: "same_school" | "same_grade_cluster";
  score: number;
  listing: {
    id: number;
    title: string;
    price: string;
    condition: string;
    classGrade: string | null;
    listingType: string | null;
    schoolId: string | null;
  };
}

interface BooklistViewItem {
  id: number;
  title: string;
  subject: string | null;
  publisher: string | null;
  isbn: string | null;
  listPriceKes: string | null;
  suggestedUsedPrice: { min: number; max: number } | null;
  matches: BooklistMatch[];
}

interface CollectionDay {
  id: number;
  date: string;
  startTime: string;
  endTime: string;
  venueNote: string | null;
}

interface BooklistView {
  year: number;
  slot: { id: number; grade: string; schoolName: string | null };
  hasBooklist: boolean;
  excludedCount: number;
  items: BooklistViewItem[];
  matchedCount: number;
  nextCollectionDay: CollectionDay | null;
}

function formatDay(day: CollectionDay) {
  const date = new Date(`${day.date}T00:00:00`);
  const label = date.toLocaleDateString("en-KE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return `${label}, ${day.startTime} to ${day.endTime}`;
}

export default function BooklistPage() {
  const { children, activeChild, setActiveChild, isLoading: loadingChildren } = useActiveChild();

  const { data, isLoading, error } = useQuery<BooklistView>({
    queryKey: ["booklist", activeChild?.id, BOOKLIST_YEAR],
    enabled: !!activeChild,
    queryFn: async () => {
      const base = `/api/booklists/child/${activeChild!.id}`;
      const query = `?year=${BOOKLIST_YEAR}`;
      // The view is read-only. Build the wishlist once (idempotent), then fetch the view.
      const build = await fetch(`${base}/build${query}`, { method: "POST", credentials: "include" });
      if (!build.ok) await throwForFailedResponse(build, "Failed to prepare the booklist");
      const response = await fetch(`${base}${query}`, { credentials: "include" });
      if (!response.ok) await throwForFailedResponse(response, "Failed to load the booklist");
      return response.json();
    },
    staleTime: 60 * 1000,
  });

  if (loadingChildren) {
    return <div className="container px-4 py-10 text-center text-muted-foreground">Loading...</div>;
  }

  if (children.length === 0) {
    return (
      <div className="container px-4 py-10 max-w-2xl mx-auto text-center space-y-4">
        <BookOpen className="w-10 h-10 mx-auto text-primary" />
        <h1 className="text-2xl font-bold">My child's {BOOKLIST_YEAR} booklist</h1>
        <p className="text-muted-foreground">
          Add a child's grade and school in your profile and we will show the books they need.
        </p>
        <Button asChild>
          <Link href="/profile">Go to profile</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="container px-4 py-8 max-w-4xl mx-auto space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-display font-bold">My child's {BOOKLIST_YEAR} booklist</h1>
        <p className="text-muted-foreground">
          Reusable, KICD-approved books for the grade and school below, with copies other families
          are passing on.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">Child slot:</span>
        <Select
          value={activeChild?.id.toString() || ""}
          onValueChange={(value) => {
            const child = children.find((c) => c.id.toString() === value);
            if (child) setActiveChild(child);
          }}
        >
          <SelectTrigger className="w-full sm:w-80">
            <SelectValue placeholder="Select a child slot" />
          </SelectTrigger>
          <SelectContent>
            {children.map((child) => (
              <SelectItem key={child.id} value={child.id.toString()}>
                {child.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="py-4 text-sm">{PILOT_PAYMENT_NOTICE}</CardContent>
      </Card>

      {isLoading && <div className="text-center py-8 text-muted-foreground">Loading the booklist...</div>}

      {error && isConsentRequiredError(error) && <ConsentBanner force />}

      {error && !isConsentRequiredError(error) && (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">{(error as Error).message}</CardContent>
        </Card>
      )}

      {data && (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-lg">
                <CalendarDays className="w-5 h-5 text-primary" />
                Next collection day at {data.slot.schoolName || "your school"}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              {data.nextCollectionDay ? (
                <>
                  <p className="font-medium">{formatDay(data.nextCollectionDay)}</p>
                  {data.nextCollectionDay.venueNote && (
                    <p className="flex items-start gap-1 text-muted-foreground">
                      <MapPin className="w-4 h-4 mt-0.5 shrink-0" />
                      {data.nextCollectionDay.venueNote}
                    </p>
                  )}
                  <p className="text-muted-foreground">
                    Bring the books you are passing on and collect the ones you reserved. Check the
                    KICD security tag at handover.
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">
                  No collection day is scheduled yet for this school. We will notify you when one is set.
                </p>
              )}
            </CardContent>
          </Card>

          {!data.hasBooklist ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                The {data.year} booklist for {data.slot.grade} at {data.slot.schoolName || "this school"} has
                not been loaded yet. We will notify you once it is.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {data.matchedCount} of {data.items.length} books have a copy available.
                {data.excludedCount > 0 &&
                  ` ${data.excludedCount} item${data.excludedCount === 1 ? "" : "s"} on the school list (workbooks or titles not on the KICD approved list) are not shown because they are not reusable.`}
              </p>

              {data.items.map((item) => (
                <Card key={item.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{item.title}</CardTitle>
                    <CardDescription>
                      {[item.subject, item.publisher].filter(Boolean).join(" • ")}
                      {item.listPriceKes && ` • List price KSh ${parseFloat(item.listPriceKes).toLocaleString()}`}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {item.suggestedUsedPrice && (
                      <p className="text-xs text-muted-foreground">
                        Suggested used price: KSh {item.suggestedUsedPrice.min.toLocaleString()} to KSh{" "}
                        {item.suggestedUsedPrice.max.toLocaleString()}
                      </p>
                    )}

                    {item.matches.length === 0 ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                        <span>No copy listed yet. We will tell you when one appears.</span>
                      </div>
                    ) : (
                      <ul className="space-y-2">
                        {item.matches.map((m) => {
                          const listingUrl = `${window.location.origin}/book/${generateBookSlug(m.listing.title, m.listing.id)}`;
                          return (
                            <li
                              key={m.listing.id}
                              className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                            >
                              <div className="space-y-1">
                                <Link
                                  href={`/book/${generateBookSlug(m.listing.title, m.listing.id)}`}
                                  className="font-medium hover:text-primary"
                                >
                                  {m.listing.title}
                                </Link>
                                <div className="flex flex-wrap gap-2 text-xs">
                                  <Badge variant={m.tier === "same_school" ? "default" : "secondary"}>
                                    {m.tier === "same_school" ? "At your school" : "Same grade, other school"}
                                  </Badge>
                                  <Badge variant="outline">{m.listing.condition}</Badge>
                                  <Badge variant="outline">
                                    {m.listing.listingType === "swap"
                                      ? "Swap"
                                      : `KSh ${parseFloat(m.listing.price).toLocaleString()}`}
                                  </Badge>
                                </div>
                              </div>
                              <Button asChild size="sm" variant="outline">
                                <a
                                  href={buildWhatsAppShareUrl({
                                    title: m.listing.title,
                                    listingUrl,
                                    grade: m.listing.classGrade,
                                  })}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <Share2 className="w-4 h-4 mr-1" />
                                  Share on WhatsApp
                                </a>
                              </Button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <div className="text-center">
            <Button asChild variant="outline">
              <Link href="/sell">Pass on a book your child has finished with</Link>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
