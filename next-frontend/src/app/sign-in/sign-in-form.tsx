"use client";

import { useActionState, useEffect, useRef } from "react";
import { CircleAlert } from "lucide-react";

import { ScopeRecord } from "@/components/shell/scope-record";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DemoAccount } from "@/lib/demo-accounts";
import {
  INITIAL_SIGN_IN_STATE,
  SIGN_IN_ERROR_MESSAGES,
  isPasswordError,
  type SignInState,
} from "@/lib/sign-in-state";
import { cn } from "@/lib/utils";
import { signIn } from "@/server/actions/auth";

import { CopyPasswordButton } from "./copy-password-button";

type Props = {
  accounts: readonly DemoAccount[];
  demoPassword: string | undefined;
};

export function SignInForm({ accounts, demoPassword }: Props) {
  const [state, formAction, pending] = useActionState<SignInState, FormData>(signIn, INITIAL_SIGN_IN_STATE);
  const passwordRef = useRef<HTMLInputElement>(null);
  const formErrorRef = useRef<HTMLDivElement>(null);

  const passwordError = isPasswordError(state.error) ? state.error : undefined;
  const formError = state.error && !passwordError ? state.error : undefined;

  // After a failed attempt, move focus to the thing to fix: the password field for a password
  // problem, otherwise the form-level message.
  useEffect(() => {
    if (passwordError) passwordRef.current?.focus();
    else if (formError) formErrorRef.current?.focus();
  }, [state, passwordError, formError]);

  return (
    <form action={formAction} className="space-y-8">
      {formError ? (
        <Alert variant="destructive" ref={formErrorRef} tabIndex={-1} aria-live="assertive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription className="text-[#7d1a14]">{SIGN_IN_ERROR_MESSAGES[formError]}</AlertDescription>
        </Alert>
      ) : null}

      <fieldset className="space-y-3">
        <legend className="mb-3 text-[0.9375rem] font-semibold">Demo account</legend>
        {accounts.map((account) => (
          <label
            key={account.key}
            className={cn(
              "group flex cursor-pointer gap-3 rounded-md border border-line bg-surface px-4 py-3.5 transition-[border-color,background-color] duration-150",
              "hover:border-input has-[:checked]:border-primary has-[:checked]:bg-[#f3f6fc] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
            )}
          >
            <input
              type="radio"
              name="account"
              value={account.key}
              defaultChecked={state.account === account.key}
              aria-labelledby={`account-${account.key}-name`}
              aria-describedby={`account-${account.key}-details`}
              className="mt-1 size-4 shrink-0 accent-primary focus-visible:outline-none"
            />
            <span className="min-w-0 flex-1 space-y-2">
              <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span id={`account-${account.key}-name`} className="font-semibold">
                  {account.displayName}
                </span>
                <span className="text-[0.8125rem] break-all text-muted-foreground" translate="no">
                  {account.email}
                </span>
              </span>
              <span id={`account-${account.key}-details`} className="block">
                <span className="sr-only">
                  {account.roleLabel}. Access: {account.scope}.
                </span>
                <ScopeRecord role={account.roleLabel} scope={account.scope} aria-hidden />
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <section aria-labelledby="demo-credentials-heading" className="space-y-2">
        <h2 id="demo-credentials-heading" className="text-[0.9375rem] font-semibold">
          Synthetic demo credentials
        </h2>
        <p className="text-sm text-muted-foreground">
          Both accounts use this public password. It opens synthetic data only.
        </p>
        {demoPassword ? (
          <div className="flex flex-col items-start gap-2 rounded-md border border-dashed border-input bg-surface px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3">
            <code className="w-full min-w-0 flex-1 overflow-x-auto font-mono text-[0.9375rem] whitespace-nowrap select-all" translate="no">
              {demoPassword}
            </code>
            <CopyPasswordButton value={demoPassword} />
          </div>
        ) : (
          <p className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-muted-foreground">
            The demo password is not configured on this deployment.
          </p>
        )}
      </section>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          ref={passwordRef}
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          spellCheck={false}
          required
          maxLength={1024}
          aria-invalid={passwordError ? true : undefined}
          aria-describedby={passwordError ? "password-error" : undefined}
        />
        <p id="password-error" aria-live="polite" className="min-h-5 text-sm text-destructive">
          {passwordError ? SIGN_IN_ERROR_MESSAGES[passwordError] : null}
        </p>
      </div>

      <Button type="submit" size="lg" className="w-full sm:w-auto sm:min-w-40" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
