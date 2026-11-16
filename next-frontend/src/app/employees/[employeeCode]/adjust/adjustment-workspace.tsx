"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useRef, useState, useTransition, type FormEvent, type ReactNode, type Ref } from "react";
import { CircleAlert, Info, TriangleAlert } from "lucide-react";

import { Money } from "@/components/directory/money";
import { ChangeRecord, SignedMoney } from "@/components/salary/salary-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDate, formatDateTime, type Currency } from "@/lib/format";
import {
  CONFIRM_LABELS,
  METHODS,
  METHOD_LABELS,
  NOTE_MAX_LENGTH,
  PERCENT_LIMITS,
  REASONS,
  REASON_LABELS,
  TARGET_LABELS,
  describeInput,
  isPercentageMethod,
  sameCommand,
  validateDraft,
  type AdjustmentDraft,
  type FormErrors,
  type FormField,
  type SalaryAdjustmentCommand,
  type SalaryAdjustmentPreview,
} from "@/lib/salary";
import { failureCopy, type FailureCopy } from "@/lib/salary-messages";
import { cn } from "@/lib/utils";
import { confirmSalaryAdjustment, previewSalaryAdjustment } from "@/server/actions/salary";

// The adjustment page: form, then the backend's exact preview, then a role-specific confirmation.
// Every figure in the preview is the backend's. The browser only checks input format.

export type WorkspaceProps = {
  employee: { code: string; name: string; jobTitle: string; department: string; countryName: string };
  current: {
    annualBaseSalary: string;
    annualBonus: string;
    annualCashCompensation: string;
    currency: Currency;
    version: number;
    stateLabel: string;
  };
  role: "ADMIN" | "SCOPED";
  todayUtc: string;
  backHref: string;
  /** Admin only: a pending request exists, so a direct change would make it out of date. */
  pendingRequest: { href: string; requestedBy: string; createdAt: string } | null;
  /** Query string to keep on the employee page after success (the directory return path). */
  detailSearch: string;
};

type Previewed = { preview: SalaryAdjustmentPreview; command: SalaryAdjustmentCommand };

const EMPTY_DRAFT = (today: string): AdjustmentDraft => ({
  target: "",
  method: "",
  value: "",
  effectiveFrom: today,
  reason: "",
  note: "",
});

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-[0.8125rem] text-destructive">
      {message}
    </p>
  );
}

function Fieldset({ legend, children, error, errorId }: { legend: string; children: ReactNode; error?: string; errorId: string }) {
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={error ? errorId : undefined}>
      <legend className="mb-1 text-sm font-semibold">{legend}</legend>
      {children}
      <FieldError id={errorId} message={error} />
    </fieldset>
  );
}

function RadioOption({
  name,
  value,
  checked,
  disabled,
  onChange,
  label,
  hint,
}: {
  name: string;
  value: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2 text-sm transition-[border-color,background-color] duration-150",
        "hover:border-input has-[:checked]:border-primary has-[:checked]:bg-[#f3f6fc] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
        disabled && "cursor-not-allowed opacity-55 hover:border-line",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
        className="mt-0.5 size-4 shrink-0 accent-primary focus-visible:outline-none"
      />
      <span>
        <span className="block font-medium">{label}</span>
        {hint ? <span className="block text-[0.8125rem] text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}

function FailureAlert({ copy, onRetry, onPreviewAgain, alertRef }: { copy: FailureCopy; onRetry?: () => void; onPreviewAgain?: () => void; alertRef?: Ref<HTMLDivElement> }) {
  return (
    <div ref={alertRef} tabIndex={-1} role="alert" className="flex items-start gap-2.5 rounded-md border border-[#e3b3ae] bg-[#fcf1f0] px-3.5 py-3 text-sm text-[#7d1a14]">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="flex flex-col gap-2">
        <p className="font-semibold">{copy.title}</p>
        <p>{copy.body}</p>
        <div className="flex flex-wrap gap-2">
          {copy.signIn ? (
            <a href="/session/expired" className="font-medium underline underline-offset-4">
              Sign in again
            </a>
          ) : null}
          {copy.retry && onRetry ? (
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
          {copy.needsPreview && onPreviewAgain ? (
            <Button type="button" variant="outline" size="sm" onClick={onPreviewAgain}>
              Preview again
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PreviewPanel({
  previewed,
  superseded,
  outdated,
  expired,
  confirming,
  confirmFailure,
  onConfirm,
  onEdit,
  onPreviewAgain,
  cancelHref,
  headingRef,
  alertRef,
  todayUtc,
}: {
  todayUtc: string;
  previewed: Previewed;
  superseded: Previewed | null;
  outdated: boolean;
  expired: boolean;
  confirming: boolean;
  confirmFailure: FailureCopy | null;
  onConfirm: () => void;
  onEdit: () => void;
  onPreviewAgain: () => void;
  cancelHref: string;
  headingRef: Ref<HTMLHeadingElement>;
  alertRef: Ref<HTMLDivElement>;
}) {
  const { preview } = previewed;
  const currency = preview.currency;
  const isBase = preview.adjustment.target === "BASE_SALARY";
  const labels = CONFIRM_LABELS[preview.confirmationMode];
  const futureDate = preview.adjustment.effectiveFrom > todayUtc;
  const blocked = outdated || expired || confirming;
  const band = preview.salaryBand;
  const future = preview.warnings.futureChange;

  return (
    <section aria-labelledby="preview-heading" className={cn("rounded-md border border-line bg-surface", outdated && "opacity-70")}>
      <div className="border-b border-line px-4 py-3">
        <h2 id="preview-heading" ref={headingRef} tabIndex={-1} className="text-[0.9375rem] font-semibold">
          Preview: nothing has changed yet
        </h2>
        <p className="text-[0.8125rem] text-muted-foreground">
          {preview.employee.name} <span translate="no">({preview.employee.employeeCode})</span>
        </p>
      </div>

      <div className="flex flex-col gap-5 px-4 py-4">
        {superseded ? (
          <div ref={alertRef} tabIndex={-1} role="alert" className="rounded-md border border-[#e5cf9f] bg-[#fbf4e4] px-3.5 py-3 text-sm">
            <p className="font-semibold">Compensation changed while you were reviewing</p>
            <p className="mt-1">
              Nothing was applied. This is a fresh preview based on compensation version {preview.expectedCompensationVersion}. Review it and
              confirm again.
            </p>
            <p className="mt-2 text-[0.8125rem] text-muted-foreground">
              Earlier result (based on version {superseded.preview.expectedCompensationVersion}), no longer valid:{" "}
              <s>
                new {TARGET_LABELS[superseded.preview.adjustment.target].toLowerCase()}{" "}
                <Money
                  amount={isBase ? superseded.preview.proposed.annualBaseSalary : superseded.preview.proposed.annualBonus}
                  currency={superseded.preview.currency}
                />
              </s>
            </p>
          </div>
        ) : null}

        {outdated ? (
          <p role="status" className="flex items-start gap-2 rounded-md border border-line bg-muted px-3 py-2 text-sm">
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            Out of date: your inputs changed. Preview again before confirming.
          </p>
        ) : null}
        {expired ? (
          <p role="status" className="flex items-start gap-2 rounded-md border border-line bg-muted px-3 py-2 text-sm">
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            This preview has expired. Preview again to see the current result.
          </p>
        ) : null}

        <div className="flex flex-col gap-3">
          <ChangeRecord
            label={TARGET_LABELS[preview.adjustment.target]}
            before={isBase ? preview.current.annualBaseSalary : preview.current.annualBonus}
            after={isBase ? preview.proposed.annualBaseSalary : preview.proposed.annualBonus}
            change={preview.change.amount}
            percentage={preview.change.percentage}
            currency={currency}
          />
          <p className="text-[0.8125rem] text-muted-foreground">
            {isBase ? "Annual bonus" : "Annual base salary"}{" "}
            <Money amount={isBase ? preview.proposed.annualBonus : preview.proposed.annualBaseSalary} currency={currency} />, unchanged. Pay
            frequency and currency do not change.
          </p>
          <ChangeRecord
            label="Annual cash compensation"
            before={preview.current.annualCashCompensation}
            after={preview.proposed.annualCashCompensation}
            currency={currency}
            emphasis={false}
          />
          {/* The cash change is the budget impact; it is shown once, under its spec name. */}
          <p className="text-sm">
            Annual budget impact: <SignedMoney amount={preview.change.annualCashImpact} currency={currency} className="font-semibold" />
          </p>
        </div>

        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 border-t border-line pt-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[0.8125rem] text-muted-foreground">Effective date</dt>
            <dd className="font-medium">
              {formatDate(preview.adjustment.effectiveFrom)}{" "}
              <span className="font-normal text-muted-foreground">{futureDate ? "(scheduled)" : "(takes effect immediately)"}</span>
            </dd>
          </div>
          <div>
            <dt className="text-[0.8125rem] text-muted-foreground">Adjustment</dt>
            <dd className="font-medium">
              {METHOD_LABELS[preview.adjustment.method]}, {describeInput(preview.adjustment.method, preview.adjustment.value)}
              {isPercentageMethod(preview.adjustment.method) ? null : ` ${currency}`}
            </dd>
          </div>
          <div>
            <dt className="text-[0.8125rem] text-muted-foreground">Reason</dt>
            <dd className="font-medium">{REASON_LABELS[preview.adjustment.reason]}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[0.8125rem] text-muted-foreground">Note</dt>
            <dd className="whitespace-pre-wrap break-words">{preview.adjustment.note ?? "No note"}</dd>
          </div>
        </dl>

        <div className="flex flex-col gap-2 border-t border-line pt-3 text-sm">
          <p className="flex items-start gap-2">
            <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-state-current" />
            <span>
              Within the salary band for {preview.employee.jobTitle} ({preview.currency}): annual base{" "}
              <Money amount={band.minAnnualBaseSalary} currency={band.currency} /> to <Money amount={band.maxAnnualBaseSalary} currency={band.currency} />,
              bonus up to <Money amount={band.maxAnnualBonus} currency={band.currency} />.
            </span>
          </p>
          {future ? (
            <p className="flex items-start gap-2 rounded-md border border-[#e5cf9f] bg-[#fbf4e4] px-3 py-2">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-state-upcoming" />
              <span>
                An approved change takes effect on {formatDate(future.effectiveFrom)}: annual base <Money amount={future.annualBaseSalary} currency={currency} />,
                annual bonus <Money amount={future.annualBonus} currency={currency} />. It is a fixed amount and will still apply on that date,
                replacing the result of this change.
              </span>
            </p>
          ) : null}
          {preview.warnings.pendingRequestWillBecomeStale ? (
            <p className="flex items-start gap-2 rounded-md border border-[#e5cf9f] bg-[#fbf4e4] px-3 py-2">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-state-upcoming" />
              <span>A salary change request for this employee is pending. Applying this change will make that request out of date.</span>
            </p>
          ) : null}
        </div>

        <p className="text-[0.75rem] text-muted-foreground">
          Based on compensation version {preview.expectedCompensationVersion}. This preview is valid until{" "}
          <time dateTime={preview.previewExpiresAt}>{formatDateTime(preview.previewExpiresAt)}</time>.
          {preview.confirmationMode === "SUBMIT_REQUEST" ? " Compensation does not change until an Admin HR user approves the request." : null}
        </p>

        {confirmFailure ? <FailureAlert copy={confirmFailure} onRetry={onConfirm} onPreviewAgain={onPreviewAgain} alertRef={alertRef} /> : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {outdated || expired ? (
            <Button type="button" size="lg" onClick={onPreviewAgain}>
              Preview again
            </Button>
          ) : (
            <Button type="button" size="lg" onClick={onConfirm} disabled={blocked}>
              {confirming ? labels.pending : labels.action}
            </Button>
          )}
          <Button type="button" variant="outline" size="lg" onClick={onEdit} disabled={confirming}>
            Edit adjustment
          </Button>
          <Link href={cancelHref} className="px-2 py-2 text-sm font-medium text-primary underline underline-offset-4">
            Cancel
          </Link>
        </div>
        <p role="status" aria-live="polite" className="sr-only">
          {confirming ? labels.pending : ""}
        </p>
      </div>
    </section>
  );
}

export function AdjustmentWorkspace(props: WorkspaceProps) {
  const { employee, current, role, todayUtc, backHref, pendingRequest, detailSearch } = props;
  const router = useRouter();
  const id = useId();
  const [draft, setDraft] = useState<AdjustmentDraft>(() => EMPTY_DRAFT(todayUtc));
  const [errors, setErrors] = useState<FormErrors>({});
  const [formFailure, setFormFailure] = useState<FailureCopy | null>(null);
  const [previewed, setPreviewed] = useState<Previewed | null>(null);
  const [superseded, setSuperseded] = useState<Previewed | null>(null);
  const [confirmFailure, setConfirmFailure] = useState<FailureCopy | null>(null);
  const [expired, setExpired] = useState(false);
  const [previewing, startPreview] = useTransition();
  const [confirming, startConfirm] = useTransition();
  const idempotencyKey = useRef<string | null>(null);
  const generation = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  // Focus requests are kept in a ref and applied after the render that shows the target.
  const pendingFocus = useRef<"preview" | "summary" | "alert" | null>(null);
  const setFocusTarget = (target: "preview" | "summary" | "alert") => {
    pendingFocus.current = target;
  };

  const currentBonusIsZero = /^0+(\.0+)?$/.test(current.annualBonus);
  const { command: draftCommand } = validateDraft(draft, { todayUtc, currentBonusIsZero });
  const outdated = previewed !== null && !sameCommand(previewed.command, draftCommand);

  // Next.js keeps a left route mounted but hidden (React Activity). Clear the form, the preview,
  // and any in-flight result when this page is hidden, so returning never shows a stale preview.
  useLayoutEffect(() => {
    return () => {
      generation.current += 1;
      setDraft(EMPTY_DRAFT(todayUtc));
      setErrors({});
      setFormFailure(null);
      setPreviewed(null);
      setSuperseded(null);
      setConfirmFailure(null);
      setExpired(false);
      idempotencyKey.current = null;
    };
  }, [todayUtc]);

  // Mark the preview expired at its backend expiry time.
  useEffect(() => {
    if (!previewed) return;
    const remaining = Math.max(0, Date.parse(previewed.preview.previewExpiresAt) - Date.now());
    const timer = setTimeout(() => setExpired(true), remaining);
    return () => clearTimeout(timer);
  }, [previewed]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    if (target === "preview") headingRef.current?.focus();
    if (target === "summary") summaryRef.current?.focus();
    if (target === "alert") alertRef.current?.focus();
  });

  function update<K extends keyof AdjustmentDraft>(key: K, value: AdjustmentDraft[K]) {
    setDraft((currentDraft) => ({ ...currentDraft, [key]: value }));
    setErrors((currentErrors) => ({ ...currentErrors, [key]: undefined }));
  }

  function runPreview() {
    const { errors: found, command } = validateDraft(draft, { todayUtc, currentBonusIsZero });
    setErrors(found);
    setFormFailure(null);
    setConfirmFailure(null);
    if (!command) {
      setFocusTarget("summary");
      return;
    }
    const started = generation.current;
    startPreview(async () => {
      const outcome = await previewSalaryAdjustment(employee.code, command);
      if (generation.current !== started) return;
      if (outcome.ok) {
        setPreviewed({ preview: outcome.preview, command });
        setSuperseded(null);
        setExpired(false);
        idempotencyKey.current = null;
        setFocusTarget("preview");
        return;
      }
      setPreviewed(null);
      const copy = failureCopy(outcome.kind, outcome.reason, "preview");
      if (copy.field) {
        setErrors({ [copy.field]: copy.body } as FormErrors);
        setFocusTarget("summary");
      } else {
        setFormFailure(copy);
        setFocusTarget("summary");
      }
    });
  }

  function onSubmitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    runPreview();
  }

  function confirm() {
    if (!previewed || outdated || expired) return;
    // One key per confirmation of this preview; "Try again" after a transport failure reuses it,
    // so the backend can return the original result instead of applying twice.
    idempotencyKey.current ??= newIdempotencyKey();
    const key = idempotencyKey.current;
    const started = generation.current;
    setConfirmFailure(null);
    startConfirm(async () => {
      const outcome = await confirmSalaryAdjustment({
        employeeCode: employee.code,
        mode: previewed.preview.confirmationMode,
        previewToken: previewed.preview.previewToken,
        adjustment: previewed.command,
        idempotencyKey: key,
      });
      if (generation.current !== started) return;
      if (outcome.ok && outcome.mode === "DIRECT_APPLY") {
        // `applied` only says which history row to highlight; the detail page never treats it as
        // proof that this browser made the change.
        const params = new URLSearchParams(detailSearch);
        params.set("applied", String(outcome.compensation.version));
        router.push(`/employees/${encodeURIComponent(employee.code)}?${params.toString()}`);
        return;
      }
      if (outcome.ok && outcome.mode === "SUBMIT_REQUEST") {
        router.push(`/salary-requests/${encodeURIComponent(outcome.request.requestId)}`);
        return;
      }
      if (!outcome.ok && outcome.kind === "STALE_VERSION" && "fresh" in outcome) {
        // Never confirm the changed result automatically: show the fresh preview and wait.
        idempotencyKey.current = null;
        // Reload the server-rendered "Current compensation" strip so it matches the fresh preview.
        // Client state (the draft and the fresh preview) survives a refresh.
        router.refresh();
        if (outcome.fresh.ok) {
          setSuperseded(previewed);
          setPreviewed({ preview: outcome.fresh.preview, command: previewed.command });
          setExpired(false);
          setFocusTarget("alert");
        } else {
          setPreviewed(null);
          const copy = failureCopy(outcome.fresh.kind, outcome.fresh.reason, "preview");
          setFormFailure({ ...copy, title: `Compensation changed. ${copy.title}` });
          if (copy.field) setErrors({ [copy.field]: copy.body } as FormErrors);
          setFocusTarget("summary");
        }
        return;
      }
      if (!outcome.ok) {
        const copy = failureCopy(outcome.kind, outcome.reason, "confirm");
        // A new preview gets a new key; only a plain retry of this one reuses it.
        if (copy.needsPreview) idempotencyKey.current = null;
        if (copy.needsPreview) setExpired(outcome.reason === "PREVIEW_EXPIRED");
        setConfirmFailure(copy);
        setFocusTarget("alert");
      }
    });
  }

  function editAdjustment() {
    setPreviewed(null);
    setSuperseded(null);
    setConfirmFailure(null);
    idempotencyKey.current = null;
    document.getElementById(`${id}-target-BASE_SALARY`)?.focus();
  }

  const errorEntries = Object.entries(errors).filter(([, message]) => message) as [FormField, string][];
  const fieldId = (field: FormField) => `${id}-${field}`;
  const methodHint =
    draft.target === "ANNUAL_BONUS" && currentBonusIsZero ? "Bonus is zero, so percentage methods are not available." : undefined;
  const valueLabel = !draft.method
    ? "Value"
    : draft.method === "PERCENTAGE_INCREASE"
      ? "Increase (%)"
      : draft.method === "PERCENTAGE_DECREASE"
        ? "Decrease (%)"
        : draft.method === "REPLACEMENT"
          ? `New ${draft.target === "ANNUAL_BONUS" ? "annual bonus" : "annual base salary"} (${current.currency})`
          : `Amount (${current.currency})`;
  const valueHint =
    draft.method && isPercentageMethod(draft.method)
      ? `A whole number from ${PERCENT_LIMITS[draft.method].min} to ${PERCENT_LIMITS[draft.method].max}. The salary band may narrow this.`
      : "At most two decimal places.";
  const noteRequired = draft.reason === "CORRECTION";
  const expectedMode = role === "ADMIN" ? "Apply salary change" : "Submit for approval";

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="current-heading">
        <h2 id="current-heading" className="text-[0.9375rem] font-semibold">
          Current compensation
        </h2>
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-line pt-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-[0.8125rem] text-muted-foreground">Annual base salary</dt>
            <dd className="font-medium">
              <Money amount={current.annualBaseSalary} currency={current.currency} />
            </dd>
          </div>
          <div>
            <dt className="text-[0.8125rem] text-muted-foreground">Annual bonus</dt>
            <dd className="font-medium">
              <Money amount={current.annualBonus} currency={current.currency} />
            </dd>
          </div>
          <div>
            <dt className="text-[0.8125rem] text-muted-foreground">Annual cash compensation</dt>
            <dd className="font-medium">
              <Money amount={current.annualCashCompensation} currency={current.currency} />
            </dd>
          </div>
          <div>
            <dt className="text-[0.8125rem] text-muted-foreground">Status</dt>
            <dd className="font-medium">
              {current.stateLabel}, version {current.version}
            </dd>
          </div>
        </dl>
      </section>

      {pendingRequest ? (
        <p className="flex max-w-3xl items-start gap-2 rounded-md border border-[#e5cf9f] bg-[#fbf4e4] px-3.5 py-2.5 text-sm">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-state-upcoming" />
          <span>
            A salary change request from {pendingRequest.requestedBy}, submitted {formatDateTime(pendingRequest.createdAt)}, is waiting for
            approval. A direct change will make it out of date.{" "}
            <Link href={pendingRequest.href} className="font-medium text-primary underline underline-offset-4">
              View request
            </Link>
          </span>
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start">
        <form onSubmit={onSubmitForm} noValidate className="flex flex-col gap-5" aria-label="Adjustment">
          <div ref={summaryRef} tabIndex={-1} className="outline-none focus-visible:outline-2">
            {errorEntries.length > 0 ? (
              <div role="alert" className="rounded-md border border-[#e3b3ae] bg-[#fcf1f0] px-3.5 py-3 text-sm text-[#7d1a14]">
                <p className="font-semibold">Check the adjustment</p>
                <ul className="mt-1 list-disc pl-5">
                  {errorEntries.map(([field, message]) => (
                    <li key={field}>
                      <a href={`#${fieldId(field)}`} className="underline underline-offset-4">
                        {message}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : formFailure ? (
              <FailureAlert copy={formFailure} onRetry={runPreview} />
            ) : null}
          </div>

          <Fieldset legend="What to change" error={errors.target} errorId={`${fieldId("target")}-error`}>
            <span id={fieldId("target")} className="sr-only" tabIndex={-1} />
            {(["BASE_SALARY", "ANNUAL_BONUS"] as const).map((target) => (
              <RadioOption
                key={target}
                name="target"
                value={target}
                checked={draft.target === target}
                onChange={(value) => update("target", value as AdjustmentDraft["target"])}
                label={TARGET_LABELS[target]}
              />
            ))}
            <p className="text-[0.8125rem] text-muted-foreground">The other value, pay frequency, and currency stay unchanged.</p>
          </Fieldset>

          <Fieldset legend="How to change it" error={errors.method} errorId={`${fieldId("method")}-error`}>
            <span id={fieldId("method")} className="sr-only" tabIndex={-1} />
            {METHODS.map((method) => (
              <RadioOption
                key={method}
                name="method"
                value={method}
                checked={draft.method === method}
                disabled={draft.target === "ANNUAL_BONUS" && currentBonusIsZero && isPercentageMethod(method)}
                onChange={(value) => update("method", value as AdjustmentDraft["method"])}
                label={METHOD_LABELS[method]}
              />
            ))}
            {methodHint ? <p className="text-[0.8125rem] text-muted-foreground">{methodHint}</p> : null}
          </Fieldset>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={fieldId("value")}>{valueLabel}</Label>
            <Input
              id={fieldId("value")}
              name="value"
              value={draft.value}
              onChange={(event) => update("value", event.target.value)}
              inputMode={draft.method && isPercentageMethod(draft.method) ? "numeric" : "decimal"}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={errors.value ? true : undefined}
              aria-describedby={`${fieldId("value")}-hint ${errors.value ? `${fieldId("value")}-error` : ""}`}
              className="max-w-xs tabular-nums"
            />
            <p id={`${fieldId("value")}-hint`} className="text-[0.8125rem] text-muted-foreground">
              {valueHint}
            </p>
            <FieldError id={`${fieldId("value")}-error`} message={errors.value} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={fieldId("effectiveFrom")}>Effective date</Label>
            <Input
              id={fieldId("effectiveFrom")}
              name="effectiveFrom"
              type="date"
              min={todayUtc}
              value={draft.effectiveFrom}
              onChange={(event) => update("effectiveFrom", event.target.value)}
              aria-invalid={errors.effectiveFrom ? true : undefined}
              aria-describedby={`${fieldId("effectiveFrom")}-hint ${errors.effectiveFrom ? `${fieldId("effectiveFrom")}-error` : ""}`}
              className="max-w-xs"
            />
            <p id={`${fieldId("effectiveFrom")}-hint`} className="text-[0.8125rem] text-muted-foreground">
              Today ({formatDate(todayUtc)}) or a future date. Dates use UTC.
            </p>
            <FieldError id={`${fieldId("effectiveFrom")}-error`} message={errors.effectiveFrom} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={fieldId("reason")}>Reason</Label>
            <NativeSelect
              id={fieldId("reason")}
              name="reason"
              value={draft.reason}
              onChange={(event) => update("reason", event.target.value as AdjustmentDraft["reason"])}
              aria-invalid={errors.reason ? true : undefined}
              aria-describedby={errors.reason ? `${fieldId("reason")}-error` : undefined}
              wrapperClassName="max-w-xs"
            >
              <option value="">Choose a reason</option>
              {REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {REASON_LABELS[reason]}
                </option>
              ))}
            </NativeSelect>
            <FieldError id={`${fieldId("reason")}-error`} message={errors.reason} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={fieldId("note")}>{noteRequired ? "Note (required for corrections)" : "Note (optional)"}</Label>
            <textarea
              id={fieldId("note")}
              name="note"
              rows={3}
              value={draft.note}
              onChange={(event) => update("note", event.target.value)}
              aria-invalid={errors.note ? true : undefined}
              aria-describedby={`${fieldId("note")}-hint ${errors.note ? `${fieldId("note")}-error` : ""}`}
              className="w-full resize-y rounded-md border border-input bg-surface px-3 py-2 text-base text-foreground transition-[border-color] duration-150 focus-visible:border-ring aria-invalid:border-destructive md:text-sm"
            />
            <p id={`${fieldId("note")}-hint`} className="text-[0.8125rem] text-muted-foreground">
              Do not include passwords, bank, health, or other sensitive details.
              {draft.note.length > NOTE_MAX_LENGTH - 200 ? ` ${draft.note.length.toLocaleString("en-US")} of 2,000 characters.` : ""}
            </p>
            <FieldError id={`${fieldId("note")}-error`} message={errors.note} />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="lg" disabled={previewing || confirming}>
              {previewing ? "Previewing…" : previewed ? "Preview again" : "Preview"}
            </Button>
            <Link href={backHref} className="text-sm font-medium text-primary underline underline-offset-4">
              Cancel
            </Link>
          </div>
          <p role="status" aria-live="polite" className="sr-only">
            {previewing ? "Previewing…" : ""}
          </p>
        </form>

        <div>
          {previewed ? (
            <PreviewPanel
              previewed={previewed}
              superseded={superseded}
              outdated={outdated}
              expired={expired}
              confirming={confirming}
              confirmFailure={confirmFailure}
              onConfirm={confirm}
              onEdit={editAdjustment}
              onPreviewAgain={runPreview}
              cancelHref={backHref}
              headingRef={headingRef}
              alertRef={alertRef}
              todayUtc={todayUtc}
            />
          ) : (
            <div className="hidden rounded-md border border-dashed border-line px-4 py-10 text-center text-sm text-muted-foreground lg:block">
              The exact result appears here after Preview. Nothing changes until you select {expectedMode}.
            </div>
          )}
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {previewed && !previewing ? `Preview ready for ${employee.name}.` : ""}
      </p>
    </div>
  );
}
