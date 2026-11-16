// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SUGGESTED_PROMPTS, type AssistantReply } from "@/lib/assistant";
import type { AssistantResult } from "@/server/actions/assistant";

import { reply } from "../support/assistant-fixtures";

const askAssistant = vi.fn<(conversation: unknown) => Promise<AssistantResult>>();
vi.mock("@/server/actions/assistant", () => ({ askAssistant: (conversation: unknown) => askAssistant(conversation) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { AssistantChat } = await import("@/app/assistant/assistant-chat");

const ok = (overrides: Record<string, unknown> = {}): AssistantResult => ({
  ok: true,
  reply: reply(overrides) as unknown as AssistantReply,
  withheld: false,
});

let setItem: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  askAssistant.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  setItem = vi.spyOn(Storage.prototype, "setItem");
});
afterEach(cleanup);

describe("AssistantChat", () => {
  it("offers the four suggested prompts and sends one when chosen", async () => {
    askAssistant.mockResolvedValueOnce(ok());
    render(<AssistantChat />);
    const buttons = screen.getAllByRole("button", { name: /Top compensation|Recent changes|Employee lookup|Summary/ });
    expect(buttons).toHaveLength(4);
    await userEvent.click(screen.getByRole("button", { name: /Top compensation/ }));
    await waitFor(() => expect(askAssistant).toHaveBeenCalledWith([{ role: "user", content: SUGGESTED_PROMPTS[0].prompt }]));
    expect(await screen.findByRole("article", { name: "Assistant answer" })).toBeVisible();
  });

  it("sends with Enter, adds a line with Shift+Enter, and sends the whole conversation next time", async () => {
    askAssistant.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok({ answer: "Second answer." }));
    const user = userEvent.setup();
    render(<AssistantChat />);
    const box = screen.getByLabelText("Ask about employees and compensation");
    await user.type(box, "First line{Shift>}{Enter}{/Shift}second line");
    expect(box).toHaveValue("First line\nsecond line");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(askAssistant).toHaveBeenCalledTimes(1));
    expect(askAssistant.mock.calls[0][0]).toEqual([{ role: "user", content: "First line\nsecond line" }]);
    await screen.findByRole("article", { name: "Assistant answer" });
    await user.type(box, "And in Tech?{Enter}");
    await waitFor(() => expect(askAssistant).toHaveBeenCalledTimes(2));
    expect(askAssistant.mock.calls[1][0]).toEqual([
      { role: "user", content: "First line\nsecond line" },
      { role: "assistant", content: reply().answer },
      { role: "user", content: "And in Tech?" },
    ]);
  });

  it("renders model text as escaped plain text", async () => {
    askAssistant.mockResolvedValueOnce(ok({ answer: '<img src=x onerror="alert(1)"><b>bold</b> [link](javascript:alert(1))', cards: [] }));
    const { container } = render(<AssistantChat />);
    await userEvent.click(screen.getByRole("button", { name: /Summary/ }));
    const article = await screen.findByRole("article", { name: "Assistant answer" });
    expect(within(article).getByText(/<img src=x onerror="alert\(1\)"><b>bold<\/b>/)).toBeVisible();
    expect(container.querySelector("img, b, script")).toBeNull();
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
  });

  it("renders tool activity, every card type with native money and rate context, and limitations", async () => {
    askAssistant.mockResolvedValueOnce(ok({ toolCalls: [{ name: "get_top_compensated_employees", status: "completed" }, { name: "drop_tables", status: "rejected" }] }));
    render(<AssistantChat />);
    await userEvent.click(screen.getByRole("button", { name: /Top compensation/ }));
    const article = await screen.findByRole("article", { name: "Assistant answer" });
    expect(within(article).getByText("Ranked employees by compensation")).toBeVisible();
    expect(within(article).getByText("rejected (not run)")).toBeVisible();

    const list = within(article).getByRole("region", { name: "Top annual cash compensation (USD comparison)" });
    expect(within(list).getByRole("link", { name: "Sneha Singh" })).toHaveAttribute("href", "/employees/ACME00042");
    expect(within(list).getAllByText("INR 25,00,000.00")[0]).toBeVisible();
    expect(within(list).getByText(/1 USD = 93\.9100 INR, effective 6 Nov 2026/)).toBeVisible();

    const summary = within(article).getByRole("region", { name: "Annual base salary by department" });
    expect(within(summary).getByText(/currencies are never added together/)).toBeVisible();
    expect(within(summary).getAllByText("INR 3,00,00,00,000.00")[0]).toBeVisible();

    const changes = within(article).getByRole("region", { name: "Compensation changes recorded in the last 90 days" });
    expect(within(changes).getByRole("link", { name: "Sneha Singh" })).toHaveAttribute("href", "/employees/ACME00042");
    // A future-effective change recorded recently shows both dates.
    expect(within(changes).getAllByText(/^Recorded/)[0]).toHaveTextContent("Recorded 15 Nov 2026, 09:12 UTC. Effective 1 Jan 2027.");
    expect(within(changes).getAllByText("INR 27,50,000.00")[0]).toBeVisible();
    expect(within(changes).getByText(/including any that take effect later/)).toBeVisible();

    expect(within(article).getByText("USD comparison uses a saved rate; it is not a payroll figure.")).toBeVisible();
    expect(within(article).getByText("Only employees within your access are included.")).toBeVisible();
  });

  it.each([
    ["ASSISTANT_UNAVAILABLE", "The assistant is unavailable"],
    ["TIMEOUT", "The assistant took too long to answer"],
    ["RATE_LIMITED", "Too many assistant requests"],
    ["INVALID_RESPONSE", "The assistant sent a response this page cannot read"],
  ] as const)("shows the %s state and retries the same question", async (error, title) => {
    askAssistant.mockResolvedValueOnce({ ok: false, error }).mockResolvedValueOnce(ok());
    render(<AssistantChat />);
    await userEvent.click(screen.getByRole("button", { name: /Recent changes/ }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(title);
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(askAssistant).toHaveBeenCalledTimes(2));
    expect(askAssistant.mock.calls[1][0]).toEqual([{ role: "user", content: SUGGESTED_PROMPTS[1].prompt }]);
    expect(await screen.findByRole("article", { name: "Assistant answer" })).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("rate-limit copy does not promise a recovery time", async () => {
    askAssistant.mockResolvedValueOnce({ ok: false, error: "RATE_LIMITED" });
    render(<AssistantChat />);
    await userEvent.click(screen.getByRole("button", { name: /Summary/ }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Too many assistant requests");
    expect(alert).toHaveTextContent("Wait and try again later.");
    expect(alert).not.toHaveTextContent(/minute|\d+\s*(s|sec|min)/i);
  });

  it("withheld out-of-scope results get a generic notice with no count", async () => {
    askAssistant.mockResolvedValueOnce({ ...ok(), withheld: true } as AssistantResult);
    render(<AssistantChat />);
    await userEvent.click(screen.getByRole("button", { name: /Summary/ }));
    const article = await screen.findByRole("article", { name: "Assistant answer" });
    const notice = within(article).getByText("Some results outside your access were not shown.");
    expect(notice).toBeVisible();
    expect(notice.textContent).not.toMatch(/\d/);
  });

  it("clears the conversation, draft, and in-flight reply when the page is hidden", async () => {
    let resolveLate: (value: AssistantResult) => void = () => {};
    askAssistant.mockResolvedValueOnce(ok()).mockImplementationOnce(() => new Promise((resolve) => (resolveLate = resolve)));
    const { Activity } = await import("react");
    const Harness = ({ mode }: { mode: "visible" | "hidden" }) => (
      <Activity mode={mode}>
        <AssistantChat />
      </Activity>
    );
    const view = render(<Harness mode="visible" />);
    await userEvent.click(screen.getByRole("button", { name: /Top compensation/ }));
    await screen.findByRole("article", { name: "Assistant answer" });
    const box = screen.getByLabelText("Ask about employees and compensation");
    await userEvent.type(box, "Second question{Enter}");
    await userEvent.type(box, "unsent draft");

    view.rerender(<Harness mode="hidden" />);
    resolveLate(ok({ answer: "Late answer" }));
    view.rerender(<Harness mode="visible" />);

    await waitFor(() => expect(screen.getByRole("button", { name: /Top compensation/ })).toBeVisible());
    expect(screen.queryByRole("list", { name: "Conversation" })).toBeNull();
    expect(screen.queryByText("Late answer")).toBeNull();
    expect(screen.getByLabelText("Ask about employees and compensation")).toHaveValue("");
  });

  it("sends an expired session to sign-in instead of retrying", async () => {
    askAssistant.mockResolvedValueOnce({ ok: false, error: "SESSION_EXPIRED" });
    render(<AssistantChat />);
    await userEvent.click(screen.getByRole("button", { name: /Summary/ }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("link", { name: "Sign in again" })).toHaveAttribute("href", "/session/expired");
    expect(within(alert).queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("blocks messages over 2,000 characters", async () => {
    render(<AssistantChat />);
    const box = screen.getByLabelText("Ask about employees and compensation");
    await userEvent.click(box);
    await userEvent.paste("x".repeat(2001));
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByText(/2,001 of 2,000 characters/)).toBeVisible();
  });

  it("never writes the conversation to browser storage", async () => {
    askAssistant.mockResolvedValue(ok());
    render(<AssistantChat />);
    await userEvent.click(screen.getByRole("button", { name: /Top compensation/ }));
    await screen.findByRole("article", { name: "Assistant answer" });
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).toBe("");
  });
});
