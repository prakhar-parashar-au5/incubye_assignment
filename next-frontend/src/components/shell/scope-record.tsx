import { cn } from "@/lib/utils";

// The access record: role and access scope set as one ruled ledger line with fixed columns.
// The same record appears on each sign-in account and in the signed-in identity block, so the
// person always sees the access they are about to use, or are using, in the same form.
export function ScopeRecord({
  role,
  scope,
  tone = "ground",
  className,
  "aria-hidden": ariaHidden,
}: {
  role: string;
  scope: string;
  tone?: "ground" | "rail";
  className?: string;
  "aria-hidden"?: boolean;
}) {
  const labelClass = tone === "rail" ? "text-rail-muted" : "text-muted-foreground";
  return (
    <dl
      aria-hidden={ariaHidden}
      className={cn(
        "grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] gap-x-3 border-t pt-2 text-[0.8125rem] leading-snug",
        tone === "rail" ? "border-rail-line" : "border-line",
        className,
      )}
    >
      <div className="min-w-0">
        <dt className={labelClass}>Role</dt>
        <dd className="font-medium">{role}</dd>
      </div>
      <div className="min-w-0">
        <dt className={labelClass}>Access</dt>
        <dd className="font-medium break-words">{scope}</dd>
      </div>
    </dl>
  );
}
