import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { ConsentNotice } from "./ConsentNotice";

function toTime(v: unknown): number | null {
  if (!v) return null;
  const t = new Date(v as string).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Mirrors server/pilot/consent.ts hasValidConsent. */
export function userHasValidConsent(
  user: { consentGivenAt?: unknown; consentWithdrawnAt?: unknown } | null | undefined
): boolean {
  if (!user) return false;
  const given = toTime(user.consentGivenAt);
  if (given === null) return false;
  const withdrawn = toTime(user.consentWithdrawnAt);
  return withdrawn === null || withdrawn < given;
}

/**
 * Shown to signed-in, onboarded parents who have no valid consent on record
 * (existing users from before the pilot, or after a withdrawal).
 */
export function ConsentBanner() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!user || !user.onboardingCompleted || userHasValidConsent(user)) return null;

  const handleAccept = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ accepted: true }),
      });
      if (!response.ok) throw new Error("Failed to save consent");
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      toast({ title: "Thank you", description: "Your consent has been recorded." });
    } catch {
      toast({
        title: "Could not save consent",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-6 space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:bg-amber-950/30">
      <p className="text-sm font-medium">We need your consent to keep your children's grade and school on file.</p>
      <ConsentNotice />
      <div className="flex items-start gap-2">
        <Checkbox
          id="banner-consent"
          checked={accepted}
          onCheckedChange={(v) => setAccepted(v === true)}
        />
        <Label htmlFor="banner-consent" className="text-sm leading-snug">
          I am the parent or guardian and I consent to this use of my children's grade and school.
        </Label>
      </div>
      <Button size="sm" disabled={!accepted || saving} onClick={handleAccept}>
        {saving ? "Saving..." : "Give consent"}
      </Button>
    </div>
  );
}
