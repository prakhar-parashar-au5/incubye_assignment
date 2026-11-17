// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SUGGESTED_PROMPTS, buildThread, type ConversationDetail, type ThreadItem } from "@/lib/assistant";
import type { SendResult } from "@/server/actions/assistant";

import { CONVERSATION_ID, TRACE_1, WITHHELD_TEXT, assistantMessage, detail, summary, turn, userMessage } from "../support/assistant-fixtures";

const sendConversationMessage = vi.fn<(input: unknown) => Promise<SendResult>>();
vi.mock("@/server/actions/assistant", () => ({ sendConversationMessage: (input: unknown) => sendConversationMessage(input) }));
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { AssistantChat } = await import("@/app/assistant/assistant-chat");

const admin = { role: "ADMIN" as const, countries: [], departments: [] };
const thread = (data: unknown): ThreadItem[] => buildThread(data as ConversationDetail, admin);
const ok = (conversationId = CONVERSATION_ID): SendResult => ({ ok: true, conversationId });
const box = () => screen.getByLabelText("Ask about employees and compensation");
const lastInput = () => sendConversationMessage.mock.calls.at(-1)![0] as Record<string, unknown>;

let setItem: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  sendConversationMessage.mockReset();
  replace.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  setItem = vi.spyOn(Storage.prototype, "setItem");
});
afterEach(cleanup);

describe("AssistantChat: new conversation", () => {
  it("offers the four suggested prompts; a choice sends one message with a fresh key and opens the saved conversation", async () => {
    sendConversationMessage.mockResolvedValueOnce(ok());
    render(<AssistantChat conversationId={null} items={[]} />);
    expect(screen.getAllByRole("button", { name: /Top compensation|Recent changes|Employee lookup|Summary/ })).toHaveLength(4);
    await userEvent.click(screen.getByRole("button", { name: /Top compensation/ }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/assistant/${CONVERSATION_ID}`));
    const input = lastInput();
    expect(input).toEqual({ conversationId: null, content: SUGGESTED_PROMPTS[0].prompt, idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(input).not.toHaveProperty("messages");
  });

  it("sends with Enter, adds a line with Shift+Enter, and shows the message while it is sent", async () => {
    let resolve: (value: SendResult) => void = () => {};
    sendConversationMessage.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const user = userEvent.setup();
    render(<AssistantChat conversationId={null} items={[]} />);
    await user.type(box(), "First line{Shift>}{Enter}{/Shift}second line");
    expect(box()).toHaveValue("First line\nsecond line");
    await user.keyboard("{Enter}");
    expect(await screen.findByText("First line\nsecond line", { normalizer: (s) => s })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("The assistant is working");
    expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();
    resolve(ok());
    await waitFor(() => expect(replace).toHaveBeenCalled());
  });

  it("a rate limit keeps the draft, says when to try again, and reuses the created conversation", async () => {
    const created = "9a9a9a9a-0000-4000-8000-000000000001";
    sendConversationMessage.mockResolvedValueOnce({ ok: false, error: "RATE_LIMITED", conversationId: created, retryAfterSeconds: 540 }).mockResolvedValueOnce(ok(created));
    render(<AssistantChat conversationId={null} items={[]} />);
    await userEvent.type(box(), "Who earns the most?{Enter}");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Too many assistant requests");
    expect(alert).toHaveTextContent("Try again in about 9 minutes.");
    expect(box()).toHaveValue("Who earns the most?");
    expect(replace).not.toHaveBeenCalled();
    await userEvent.type(box(), "{Enter}");
    await waitFor(() => expect(lastInput().conversationId).toBe(created));
  });

  it("a recorded failure on the first message opens the conversation, where the failed turn is shown", async () => {
    sendConversationMessage.mockResolvedValueOnce({ ok: false, error: "RECORDED_FAILURE", conversationId: CONVERSATION_ID });
    render(<AssistantChat conversationId={null} items={[]} />);
    await userEvent.type(box(), "Who earns the most?{Enter}");
    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/assistant/${CONVERSATION_ID}`));
  });

  it("sends an expired session to sign-in", async () => {
    sendConversationMessage.mockResolvedValueOnce({ ok: false, error: "SESSION_EXPIRED", conversationId: null });
    render(<AssistantChat conversationId={null} items={[]} />);
    await userEvent.type(box(), "hi{Enter}");
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("link", { name: "Sign in again" })).toHaveAttribute("href", "/session/expired");
  });

  it("blocks messages over 2,000 characters", async () => {
    render(<AssistantChat conversationId={null} items={[]} />);
    await userEvent.click(box());
    await userEvent.paste("x".repeat(2001));
    expect(box()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByText(/2,001 of 2,000 characters/)).toBeVisible();
  });
});

describe("AssistantChat: saved conversation", () => {
  it("renders the saved thread in order with cards, limitations, and a retried failure", () => {
    render(<AssistantChat conversationId={CONVERSATION_ID} items={thread(detail())} />);
    const list = screen.getByRole("list", { name: "Conversation" });
    const answers = within(list).getAllByRole("article", { name: "Assistant answer" });
    expect(answers).toHaveLength(2);
    expect(within(answers[0]).getByText("Ranked employees by compensation")).toBeVisible();
    expect(within(answers[0]).getAllByText("INR 25,00,000.00")[0]).toBeVisible();
    expect(within(answers[0]).getByText("Only employees within your access are included.")).toBeVisible();
    expect(within(list).getByText("The assistant is not configured")).toBeVisible();
    expect(within(list).getByText("Retried below.")).toBeVisible();
    expect(within(list).queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Try a question" })).toBeNull();
  });

  it("continues the conversation with one new message and its own key", async () => {
    sendConversationMessage.mockResolvedValue(ok());
    render(<AssistantChat conversationId={CONVERSATION_ID} items={thread(detail())} />);
    await userEvent.type(box(), "And in HR?{Enter}");
    await waitFor(() => expect(sendConversationMessage).toHaveBeenCalledTimes(1));
    const first = lastInput();
    expect(first).toEqual({ conversationId: CONVERSATION_ID, content: "And in HR?", idempotencyKey: expect.any(String) });
    await userEvent.type(box(), "And in Tech?{Enter}");
    await waitFor(() => expect(sendConversationMessage).toHaveBeenCalledTimes(2));
    expect(lastInput().idempotencyKey).not.toBe(first.idempotencyKey);
    expect(replace).not.toHaveBeenCalled();
  });

  it("Retry on a recorded failed turn sends that message as a new turn: new key and retryOfTraceId", async () => {
    sendConversationMessage.mockResolvedValue(ok());
    const failed = { conversation: summary(), messages: [userMessage(1, "Top earners?", TRACE_1)], turns: [turn(1, TRACE_1, "FAILED", { userMessageSequence: 1 })] };
    render(<AssistantChat conversationId={CONVERSATION_ID} items={thread(failed)} />);
    expect(screen.getByText("No language model is set up in this environment, so nothing was answered. Your message was saved. The employee directory still works.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(sendConversationMessage).toHaveBeenCalledTimes(1));
    expect(lastInput()).toEqual({ conversationId: CONVERSATION_ID, content: "Top earners?", idempotencyKey: expect.any(String), retryOfTraceId: TRACE_1 });
  });

  it("an unconfirmed send offers Send again with the SAME key, and Discard puts the text back", async () => {
    sendConversationMessage.mockResolvedValueOnce({ ok: false, error: "UNCONFIRMED", conversationId: CONVERSATION_ID }).mockRejectedValueOnce(new Error("network"));
    render(<AssistantChat conversationId={CONVERSATION_ID} items={[]} />);
    await userEvent.type(box(), "Who earns the most?{Enter}");
    expect(await screen.findByText("This message may not have been received")).toBeVisible();
    const key = lastInput().idempotencyKey;
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Send again" }));
    await waitFor(() => expect(sendConversationMessage).toHaveBeenCalledTimes(2));
    expect(lastInput()).toEqual({ conversationId: CONVERSATION_ID, content: "Who earns the most?", idempotencyKey: key });
    // The second attempt threw in the browser: still unconfirmed.
    expect(await screen.findByText("This message may not have been received")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByText("This message may not have been received")).toBeNull();
    expect(box()).toHaveValue("Who earns the most?");
  });

  it("a withheld answer shows only the fixed text, with no cards, limitations, or Retry", () => {
    const data = {
      conversation: summary(),
      messages: [userMessage(1, "q", TRACE_1), assistantMessage(2, TRACE_1, { withheld: true, response: null, text: WITHHELD_TEXT })],
      turns: [turn(1, TRACE_1, "COMPLETED", { userMessageSequence: 1, assistantMessageSequence: 2 })],
    };
    render(<AssistantChat conversationId={CONVERSATION_ID} items={thread(data)} />);
    const withheld = screen.getByRole("article", { name: "Assistant answer withheld" });
    expect(withheld).toHaveTextContent(WITHHELD_TEXT);
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryByText("Limitations")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByRole("article", { name: "Assistant answer" })).toBeNull();
  });

  it("a still-running turn offers a full reload to check again", () => {
    const data = { conversation: summary(), messages: [userMessage(1, "q", TRACE_1)], turns: [turn(1, TRACE_1, "STARTED", { userMessageSequence: 1 })] };
    render(<AssistantChat conversationId={CONVERSATION_ID} items={thread(data)} />);
    expect(screen.getByText("Still working on this message.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Check again" })).toHaveAttribute("href", `/assistant/${CONVERSATION_ID}`);
  });

  it("renders model text as escaped plain text", () => {
    const html = '<img src=x onerror="alert(1)"><b>bold</b> [link](javascript:alert(1))';
    const data = {
      conversation: summary(),
      messages: [userMessage(1, "<script>x</script>", TRACE_1), assistantMessage(2, TRACE_1, { text: html })],
      turns: [turn(1, TRACE_1, "COMPLETED", { userMessageSequence: 1, assistantMessageSequence: 2 })],
    };
    const { container } = render(<AssistantChat conversationId={CONVERSATION_ID} items={thread(data)} />);
    expect(screen.getByText(/<img src=x onerror="alert\(1\)"><b>bold<\/b>/)).toBeVisible();
    expect(screen.getByText("<script>x</script>")).toBeVisible();
    expect(container.querySelector("img, b, script")).toBeNull();
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
  });

  it("marks removed turns", () => {
    const data = {
      conversation: summary(),
      messages: [userMessage(3, "later", TRACE_1), assistantMessage(4, TRACE_1)],
      turns: [turn(2, TRACE_1, "COMPLETED", { userMessageSequence: 3, assistantMessageSequence: 4 })],
    };
    render(<AssistantChat conversationId={CONVERSATION_ID} items={thread(data)} />);
    expect(screen.getByText("Earlier messages in this conversation were removed.")).toBeVisible();
  });

  it("clears the draft and drops a late result when the page is hidden", async () => {
    let resolveLate: (value: SendResult) => void = () => {};
    sendConversationMessage.mockImplementationOnce(() => new Promise((resolve) => (resolveLate = resolve)));
    const { Activity } = await import("react");
    const Harness = ({ mode }: { mode: "visible" | "hidden" }) => (
      <Activity mode={mode}>
        <AssistantChat conversationId={null} items={[]} />
      </Activity>
    );
    const view = render(<Harness mode="visible" />);
    await userEvent.type(box(), "Second question{Enter}");
    await userEvent.type(box(), "unsent draft");
    view.rerender(<Harness mode="hidden" />);
    resolveLate(ok());
    view.rerender(<Harness mode="visible" />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Top compensation/ })).toBeVisible());
    expect(box()).toHaveValue("");
    expect(replace).not.toHaveBeenCalled();
  });

  it("never writes the conversation to browser storage", async () => {
    sendConversationMessage.mockResolvedValue(ok());
    render(<AssistantChat conversationId={CONVERSATION_ID} items={thread(detail())} />);
    await userEvent.type(box(), "And in HR?{Enter}");
    await waitFor(() => expect(sendConversationMessage).toHaveBeenCalled());
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).toBe("");
  });
});
