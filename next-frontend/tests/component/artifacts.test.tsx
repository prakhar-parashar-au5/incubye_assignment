// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ArtifactCardList, ArtifactFrame, Sources } from "@/components/artifacts/artifacts-ui";
import { ARTIFACT_CARDS } from "@/lib/artifacts";

afterEach(cleanup);

describe("Artifacts overview cards", () => {
  it("shows one entry per artifact with a title, one sentence, and a link", () => {
    render(<ArtifactCardList cards={ARTIFACT_CARDS} available={new Set(["F1.html", "F2.html", "F3.html", "schema.html"])} />);
    const overview = screen.getByRole("navigation", { name: "Artifacts" });
    const items = within(overview).getAllByRole("listitem");
    expect(items).toHaveLength(13);
    const links = within(overview).getAllByRole("link");
    // Task 07b order: the thinking first, then how it works, then quality and history.
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/artifacts/requirements",
      "/artifacts/decisions",
      "/artifacts/tech-stack",
      "/artifacts/how-it-was-built",
      "/artifacts/specs",
      "/artifacts/database",
      "/artifacts/flows/employees-click",
      "/artifacts/flows/assistant-tool-call",
      "/artifacts/flows/salary-request",
      "/artifacts/ai-evaluation",
      "/artifacts/testing",
      "/artifacts/performance",
      "/artifacts/evolution",
    ]);
    for (const [index, card] of ARTIFACT_CARDS.entries()) {
      expect(within(items[index]).getByRole("heading", { level: 3, name: card.title })).toBeVisible();
      expect(within(items[index]).getByText(card.summary)).toBeVisible();
      // One sentence each.
      expect(card.summary.match(/[.!?](\s|$)/g)).toHaveLength(1);
    }
  });

  it("groups the entries under three headings: 1–5, 6–9, and 10–13", () => {
    render(<ArtifactCardList cards={ARTIFACT_CARDS} available={new Set(["F1.html", "F2.html", "F3.html", "schema.html"])} />);
    const overview = screen.getByRole("navigation", { name: "Artifacts" });
    expect(within(overview).getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Thinking", "How it works", "Quality and history"]);
    const counts = ["Thinking", "How it works", "Quality and history"].map((name) => within(within(overview).getByRole("list", { name })).getAllByRole("listitem").length);
    expect(counts).toEqual([5, 4, 4]);
  });

  it("an artifact whose page is not synced yet is plain text marked Coming soon, not a link", () => {
    render(<ArtifactCardList cards={ARTIFACT_CARDS} available={new Set(["F1.html", "F2.html"])} />);
    const list = screen.getByRole("navigation", { name: "Artifacts" });
    expect(within(list).getAllByRole("link")).toHaveLength(11);
    expect(within(list).queryByRole("link", { name: /salary request/i })).toBeNull();
    expect(within(list).queryByRole("link", { name: "Database schema" })).toBeNull();
    expect(within(list).getAllByText("Coming soon")).toHaveLength(2);
    expect(within(list).getByText("Request flow F3")).toHaveTextContent("Request flow F3Coming soon");
    expect(within(list).getByText("Database")).toHaveTextContent("DatabaseComing soon");
    expect(within(list).getByRole("link", { name: "Tech stack" })).toBeVisible();
  });
});

describe("embedded artifact", () => {
  it("is a sandboxed iframe with no tokens and an Open full page link to the same raw route", () => {
    render(<ArtifactFrame file="F1.html" title="Request flow F1" />);
    const frame = screen.getByTitle("Request flow F1");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame).toHaveAttribute("src", "/artifacts/raw/F1.html");
    expect(screen.getByRole("link", { name: "Open full page" })).toHaveAttribute("href", "/artifacts/raw/F1.html");
  });
});

describe("sources", () => {
  it("links every repository path, including the evaluator report now on master", () => {
    render(
      <Sources
        sources={[
          { path: "docs/27-agent-blocker-reporting-protocol.md" },
          { path: "tester_docs/ai-assistant-tester/responses/01-live-assistant-and-trace-evaluation.md", note: "section 8" },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "docs/27-agent-blocker-reporting-protocol.md" })).toHaveAttribute(
      "href",
      "https://github.com/prakhar-parashar-au5/incubye_assignment/blob/master/docs/27-agent-blocker-reporting-protocol.md",
    );
    expect(screen.getByRole("link", { name: /01-live-assistant-and-trace-evaluation\.md$/ })).toHaveAttribute(
      "href",
      "https://github.com/prakhar-parashar-au5/incubye_assignment/blob/master/tester_docs/ai-assistant-tester/responses/01-live-assistant-and-trace-evaluation.md",
    );
    expect(screen.queryByText(/not on master yet/)).toBeNull();
  });
});
