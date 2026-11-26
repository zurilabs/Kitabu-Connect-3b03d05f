import { CONSENT_VERSION } from "@/config/pilot";

/**
 * Short parental consent notice (adr-016, ODPC children's data guidance).
 * Keep it short and plain: who we are, what we collect, why, no sharing, how to withdraw.
 */
export function ConsentNotice() {
  return (
    <div
      className="rounded-lg border bg-muted/40 p-4 text-sm space-y-2"
      data-testid="consent-notice"
    >
      <p className="font-medium">Before you join: how we use your family's details</p>
      <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
        <li>
          <span className="font-medium text-foreground">Who we are:</span> Zuri Labs Africa,
          Nairobi, Kenya, the operator of Kitabu Connect.
        </li>
        <li>
          <span className="font-medium text-foreground">What we collect:</span> your name, email
          and phone number; for each child only the grade, school and curriculum (never a child's
          name); and the books you list or want.
        </li>
        <li>
          <span className="font-medium text-foreground">Why:</span> to match you with other
          parents at your school for used textbooks, and to tell you when a book is available and
          when the next collection day is.
        </li>
        <li>
          <span className="font-medium text-foreground">No sharing:</span> we do not sell your
          data or share it with advertisers. Other parents see only the books you list. We use
          basic usage analytics to improve the service.
        </li>
        <li>
          <span className="font-medium text-foreground">Withdraw any time:</span> in your Profile,
          choose "Withdraw consent and delete my children's data". Your child slots are deleted
          straight away.
        </li>
      </ul>
      <p className="text-xs text-muted-foreground">Notice version {CONSENT_VERSION}</p>
    </div>
  );
}
