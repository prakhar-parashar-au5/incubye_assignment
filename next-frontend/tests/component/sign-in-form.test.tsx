// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEMO_ACCOUNTS } from "@/lib/demo-accounts";
import type { SignInState } from "@/lib/sign-in-state";

const signIn = vi.fn<(state: SignInState, data: FormData) => Promise<SignInState>>();
vi.mock("@/server/actions/auth", () => ({ signIn: (state: SignInState, data: FormData) => signIn(state, data) }));

const { SignInForm } = await import("@/app/sign-in/sign-in-form");

afterEach(cleanup);

describe("SignInForm", () => {
  it("shows both demo accounts with role and scope, and the labelled shared password", () => {
    render(<SignInForm accounts={DEMO_ACCOUNTS} demoPassword="synthetic-demo-pass" />);
    const meera = screen.getByRole("radio", { name: "Meera Iyer" });
    const rohan = screen.getByRole("radio", { name: "Rohan Mehta" });
    expect(meera).toBeChecked();
    expect(meera).toHaveAccessibleDescription("Admin HR. Access: All employees.");
    expect(rohan).toHaveAccessibleDescription("Scoped HR. Access: India, Support and Tech.");
    expect(screen.getByRole("heading", { name: "Synthetic demo credentials" })).toBeVisible();
    expect(screen.getByText("synthetic-demo-pass")).toBeVisible();
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
  });

  it("signs in with the keyboard only, then keeps the account and focuses the field after an error", async () => {
    signIn.mockResolvedValueOnce({ account: "rohan", error: "INVALID_CREDENTIALS" });
    const user = userEvent.setup();
    render(<SignInForm accounts={DEMO_ACCOUNTS} demoPassword="synthetic-demo-pass" />);

    await user.tab(); // first radio in the group
    expect(screen.getByRole("radio", { name: "Meera Iyer" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("radio", { name: "Rohan Mehta" })).toBeChecked();
    await user.tab(); // Copy password
    await user.tab(); // Password
    expect(screen.getByLabelText("Password")).toHaveFocus();
    await user.keyboard("synthetic-wrong{Enter}");

    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(1));
    const submitted = signIn.mock.calls[0][1];
    expect(submitted.get("account")).toBe("rohan");
    expect(submitted.get("password")).toBe("synthetic-wrong");
    expect(submitted.has("email")).toBe(false);

    const password = screen.getByLabelText("Password");
    await waitFor(() => expect(password).toHaveAccessibleDescription(/not correct for this account/));
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(password).toHaveFocus();
    expect(password).toHaveValue("");
    expect(screen.getByRole("radio", { name: "Rohan Mehta" })).toBeChecked();
  });

  it("shows a form-level message for rate limiting", async () => {
    signIn.mockResolvedValueOnce({ account: "meera", error: "RATE_LIMITED" });
    const user = userEvent.setup();
    render(<SignInForm accounts={DEMO_ACCOUNTS} demoPassword="synthetic-demo-pass" />);
    await user.type(screen.getByLabelText("Password"), "synthetic-pass{Enter}");
    expect(await screen.findByText(/Too many failed attempts for this account/)).toBeVisible();
    expect(screen.getByRole("radio", { name: "Meera Iyer" })).toBeChecked();
  });

  it("says when the demo password is not configured", () => {
    render(<SignInForm accounts={DEMO_ACCOUNTS} demoPassword={undefined} />);
    expect(screen.getByText("The demo password is not configured on this deployment.")).toBeVisible();
  });
});
