import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SchoolCombobox } from "@/components/ui/school-combobox";
import { School, ShieldCheck, Phone, Users, X, Plus } from "lucide-react";
import onboardingHero from "@assets/generated_images/friendly_parents_talking_at_school_gate.png";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { generateDeviceFingerprint } from "@/lib/deviceFingerprint";
import { PILOT_MODE, PILOT_PAYMENT_NOTICE } from "@/config/pilot";
import { ConsentNotice } from "@/components/pilot/ConsentNotice";
import { userHasValidConsent } from "@/components/pilot/ConsentBanner";

const GRADES = [
  "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6",
  "Grade 7", "Grade 8", "Grade 9", "Grade 10",
  "Form 1", "Form 2", "Form 3", "Form 4"
];

const CURRICULA = ["CBC", "8-4-4"];

const ONBOARDING_DATA_KEY = "onboarding_progress";

/** A child slot: grade + school (+ curriculum). No child name is collected (adr-016). */
interface ChildSlotData {
  grade: string;
  schoolId: string;
  schoolName: string;
  curriculum: string;
}

const emptySlot = (): ChildSlotData => ({ grade: "", schoolId: "", schoolName: "", curriculum: "" });

/**
 * One-screen onboarding: your details, child slots (grade + school), consent, Join.
 */
export default function Onboarding() {
  const [loading, setLoading] = useState(false);
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [slots, setSlots] = useState<ChildSlotData[]>([emptySlot()]);
  const [consentAccepted, setConsentAccepted] = useState(false);

  const alreadyConsented = userHasValidConsent(user);

  // Pre-fill from the account (Google sign-in or an earlier save)
  useEffect(() => {
    if (user?.fullName) {
      const nameParts = user.fullName.trim().split(/\s+/);
      setFirstName(nameParts[0] || "");
      setLastName(nameParts.slice(1).join(" "));
    }
    if (user?.phoneNumber) {
      setPhoneNumber(user.phoneNumber);
    }
  }, [user]);

  const trackReferralSignup = async () => {
    if (PILOT_MODE) return; // referrals are deferred in pilot mode
    const referralCode = localStorage.getItem("pendingReferralCode");
    if (!referralCode) return;
    try {
      const response = await fetch("/api/referrals/track-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ referralCode, deviceFingerprint: generateDeviceFingerprint() }),
      });
      if (response.ok) localStorage.removeItem("pendingReferralCode");
    } catch (error) {
      console.error("Error tracking referral:", error);
    }
  };

  const updateSlot = (index: number, patch: Partial<ChildSlotData>) => {
    setSlots((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  // A completely empty row is ignored; a half-filled row blocks Join.
  const filledSlots = slots.filter((s) => s.grade || s.schoolId);
  const slotsValid = filledSlots.every((s) => s.grade && s.schoolId);
  const canSubmit =
    !loading &&
    firstName.trim() &&
    lastName.trim() &&
    phoneNumber.trim() &&
    slotsValid &&
    (alreadyConsented || consentAccepted);

  const handleJoin = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          fullName: `${firstName.trim()} ${lastName.trim()}`,
          phoneNumber,
          children: filledSlots.map((s) => ({
            grade: s.grade,
            schoolId: s.schoolId,
            schoolName: s.schoolName,
            curriculum: s.curriculum || null,
          })),
          consentAccepted: alreadyConsented ? undefined : consentAccepted,
          markAsComplete: true,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || "Failed to complete onboarding");
      }

      await trackReferralSignup();
      localStorage.removeItem(ONBOARDING_DATA_KEY);
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      await queryClient.invalidateQueries({ queryKey: ["children"] });

      setLocation(PILOT_MODE && filledSlots.length > 0 ? "/booklist" : "/marketplace");
    } catch (error) {
      console.error("Onboarding error:", error);
      toast({
        title: "Could not finish joining",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left Panel - Visuals */}
      <div className="hidden lg:flex flex-col relative bg-muted text-white">
        <div className="absolute inset-0">
          <img src={onboardingHero} alt="Parents Community" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-primary/90 mix-blend-multiply" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        </div>

        <div className="relative z-10 flex flex-col h-full justify-between p-12">
          <div className="flex items-center gap-2">
            <School className="w-8 h-8" />
            <span className="text-2xl font-bold font-display">Kitabu</span>
          </div>

          <div className="space-y-6 max-w-lg">
            <h1 className="text-4xl font-display font-bold leading-tight">
              Join your school's trusted parent community.
            </h1>
            <p className="text-lg text-white/90">
              {PILOT_MODE
                ? "Pass on the books your child has finished with and find the ones they need next, with families at your own school. No fees."
                : "Buy and sell textbooks directly with other parents in your school network."}
            </p>

            <div className="flex gap-4 pt-4">
              <div className="flex items-center gap-2 text-sm font-medium bg-white/10 px-4 py-2 rounded-full backdrop-blur-sm">
                <ShieldCheck className="w-4 h-4" />
                Verified Parents Only
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel - One-screen form */}
      <div className="flex flex-col justify-center items-center p-6 lg:p-12 bg-background">
        <div className="w-full max-w-md space-y-6">
          <div className="space-y-2 text-center lg:text-left">
            <h2 className="text-3xl font-display font-bold">Create Parent Account</h2>
            <p className="text-muted-foreground">One quick screen, then you are in.</p>
          </div>

          {/* Your details */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  placeholder="Jane"
                  className="h-12"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  placeholder="Doe"
                  className="h-12"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="phoneNumber">Phone Number</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-3.5 h-5 w-5 text-muted-foreground" />
                <Input
                  id="phoneNumber"
                  type="tel"
                  placeholder="0712 345 678 or +254712345678"
                  className="pl-10 h-12"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                So other parents can reach you to arrange the handover
              </p>
            </div>
          </div>

          {/* Child slots */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" />
              <h3 className="font-semibold">Your children's school and grade</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              We only need the grade and school for each child, not their name. This builds the
              booklist you will see.
            </p>

            <div className="space-y-3">
              {slots.map((slot, index) => (
                <div key={index} className="p-4 border rounded-lg space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="font-semibold">Child {index + 1}</Label>
                    {slots.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove child ${index + 1}`}
                        onClick={() => setSlots(slots.filter((_, i) => i !== index))}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`slot-grade-${index}`}>Grade *</Label>
                    <Select value={slot.grade} onValueChange={(value) => updateSlot(index, { grade: value })}>
                      <SelectTrigger id={`slot-grade-${index}`}>
                        <SelectValue placeholder="Select grade" />
                      </SelectTrigger>
                      <SelectContent className="max-h-[300px] overflow-y-auto">
                        {GRADES.map((grade) => (
                          <SelectItem key={grade} value={grade}>
                            {grade}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>School *</Label>
                    <SchoolCombobox
                      value={slot.schoolId}
                      onChange={(schoolId, schoolName) => updateSlot(index, { schoolId, schoolName })}
                      placeholder="Search for school"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`slot-curriculum-${index}`}>Curriculum (optional)</Label>
                    <Select
                      value={slot.curriculum}
                      onValueChange={(value) => updateSlot(index, { curriculum: value })}
                    >
                      <SelectTrigger id={`slot-curriculum-${index}`}>
                        <SelectValue placeholder="CBC or 8-4-4" />
                      </SelectTrigger>
                      <SelectContent>
                        {CURRICULA.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
            </div>

            <Button variant="outline" className="w-full" onClick={() => setSlots([...slots, emptySlot()])}>
              <Plus className="w-4 h-4 mr-2" />
              Add another child
            </Button>
          </div>

          {/* Consent */}
          {!alreadyConsented && (
            <div className="space-y-3">
              <ConsentNotice />
              <div className="flex items-start gap-2">
                <Checkbox
                  id="consent"
                  checked={consentAccepted}
                  onCheckedChange={(v) => setConsentAccepted(v === true)}
                />
                <Label htmlFor="consent" className="text-sm leading-snug">
                  I am the parent or guardian of these children and I consent to this use of their
                  grade and school.
                </Label>
              </div>
            </div>
          )}

          {PILOT_MODE && <p className="text-xs text-muted-foreground">{PILOT_PAYMENT_NOTICE}</p>}

          <Button onClick={handleJoin} className="w-full h-12 bg-primary hover:bg-primary/90" disabled={!canSubmit}>
            {loading ? "Joining..." : "Join"}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            By continuing, you agree to our Terms of Service and Privacy Policy
          </p>
        </div>
      </div>
    </div>
  );
}
