import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { userHasValidConsent } from "./ConsentBanner";

/**
 * Profile card: shows consent status and lets a parent withdraw consent and delete
 * their children's data (child slots and wishlist links). adr-016.
 */
export function WithdrawConsentCard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [working, setWorking] = useState(false);

  const hasConsent = userHasValidConsent(user);

  const handleWithdraw = async () => {
    setWorking(true);
    try {
      const response = await fetch("/api/consent/withdraw", {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to withdraw consent");
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      await queryClient.invalidateQueries({ queryKey: ["children"] });
      await queryClient.invalidateQueries({ queryKey: ["wishlist"] });
      toast({
        title: "Consent withdrawn",
        description: "Your children's data has been deleted.",
      });
      setLocation("/dashboard");
    } catch {
      toast({
        title: "Could not withdraw consent",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setWorking(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Privacy and consent</CardTitle>
        <CardDescription>
          {hasConsent
            ? "You have given consent for us to keep your children's grade and school on file."
            : "No consent is on file. Your children's grade and school are not kept."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="text-destructive" disabled={working}>
              Withdraw consent and delete my children's data
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Withdraw consent?</AlertDialogTitle>
              <AlertDialogDescription>
                This deletes all your child slots (grade and school) and the booklist wishlist
                built from them. It cannot be undone. Your own listings stay until you remove them.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep my data</AlertDialogCancel>
              <AlertDialogAction onClick={handleWithdraw}>Withdraw and delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
