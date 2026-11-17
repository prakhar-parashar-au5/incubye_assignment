import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ARTIFACT_CARDS } from "@/lib/artifacts";
import {
  DECISION_CARDS,
  EVAL_METHOD,
  EVAL_RECHECK,
  MILESTONES,
  PERFORMANCE_DOC,
  PERFORMANCE_FINDINGS,
  PERFORMANCE_NEXT,
  PERFORMANCE_SETUP,
  PERFORMANCE_TABLES,
  REQUIREMENTS_CHANGES,
  SALARY_EXAMPLE,
  SPEC_PAIRS,
  TESTING_COVERAGE,
  TESTING_DOC,
  TESTING_LAYERS,
  TESTING_POINTS,
  TESTS_THAT_MATTER,
  commitHref,
  readMilestones,
} from "@/lib/artifacts-more";

const frontendRoot = path.resolve(__dirname, "../..");
const repoRoot = path.resolve(frontendRoot, "..");

describe("Task 07a content is traceable", () => {
  it("every cited path exists, including inline links on every artifact page", async () => {
    const cited = [
      ...REQUIREMENTS_CHANGES.flatMap((item) => item.sources),
      ...DECISION_CARDS.flatMap((card) => card.sources),
      ...SALARY_EXAMPLE.humanSources,
      ...SALARY_EXAMPLE.agents.flatMap((item) => item.sources),
      ...EVAL_METHOD.flatMap((item) => item.sources),
      ...EVAL_RECHECK.sources,
      ...PERFORMANCE_TABLES.flatMap((table) => table.sources),
      ...PERFORMANCE_FINDINGS.flatMap((item) => item.sources),
      ...PERFORMANCE_NEXT.sources,
      ...TESTING_POINTS.flatMap((item) => item.sources),
      ...TESTS_THAT_MATTER.map((test) => test.source),
    ].map((source) => source.path);
    const paired = SPEC_PAIRS.flatMap((pair) => [pair.human, ...pair.agent]);
    const inline: string[] = [];
    const pagesDir = path.join(frontendRoot, "src/app/artifacts");
    for (const entry of await readdir(pagesDir, { recursive: true })) {
      if (!String(entry).endsWith("page.tsx")) continue;
      const page = await readFile(path.join(pagesDir, String(entry)), "utf8");
      inline.push(...[...page.matchAll(/<RepoPath path="([^"]+)"/g)].map((match) => match[1]));
      inline.push(...[...page.matchAll(/path: "([^"]+\.(?:md|ts|json))"/g)].map((match) => match[1]));
    }
    const all = [...new Set([...cited, ...paired, ...inline])];
    expect(all.length).toBeGreaterThan(60);
    expect(all.filter((p) => !existsSync(path.join(repoRoot, p)))).toEqual([]);
  });

  it("each human spec in the table is a docs_human file, and every docs_human spec is paired", async () => {
    const human = (await readdir(path.join(repoRoot, "docs_human"))).filter((name) => name.endsWith(".md")).map((name) => `docs_human/${name}`);
    expect(SPEC_PAIRS.map((pair) => pair.human).sort()).toEqual(human.sort());
    for (const pair of SPEC_PAIRS) for (const agent of pair.agent) expect(agent.startsWith("docs_human/")).toBe(false);
  });
});

describe("decision cards", () => {
  it("has 10 to 14 cards, each with all four parts and a source", () => {
    expect(DECISION_CARDS.length).toBeGreaterThanOrEqual(10);
    expect(DECISION_CARDS.length).toBeLessThanOrEqual(14);
    for (const card of DECISION_CARDS) {
      for (const part of [card.decision, card.options, card.why, card.cost]) expect(part.trim().length, card.title).toBeGreaterThan(10);
      expect(card.sources.length, card.title).toBeGreaterThan(0);
    }
  });

  it("covers every topic the task requires", () => {
    const text = DECISION_CARDS.map((card) => `${card.title} ${card.decision} ${card.options}`).join("\n");
    for (const topic of [/MySQL/, /SQLite/, /HttpOnly/, /every (authenticated )?request/, /versions?/, /idempotency/i, /decimal/i, /currenc/i, /same 404/, /Zod/, /fails closed/i, /Option C/, /read-only/i, /OAuth/, /SSO/, /payroll/i]) {
      expect(text, String(topic)).toMatch(topic);
    }
  });

  it("the overview card states the real number of decisions", () => {
    const card = ARTIFACT_CARDS.find((item) => item.href === "/artifacts/decisions");
    const words = ["Ten", "Eleven", "Twelve", "Thirteen", "Fourteen"];
    expect(card?.summary.startsWith(words[DECISION_CARDS.length - 10])).toBe(true);
  });
});

describe("Performance and Testing use measured numbers only", () => {
  // Every number on the two pages must appear verbatim in its source document.
  const numbers = (text: string) => text.match(/\d(?:[\d,]*\d)?(?:\.\d+)?%?/g) ?? [];

  it("every number on the Performance page is in docs/performance.md", async () => {
    const doc = await readFile(path.join(repoRoot, PERFORMANCE_DOC), "utf8");
    const shown = [
      ...PERFORMANCE_SETUP.map((item) => item.value),
      ...PERFORMANCE_TABLES.flatMap((table) => table.rows.flatMap((row) => [row.query, row.rows, row.p50, row.p95, row.note])),
      ...PERFORMANCE_FINDINGS.map((item) => item.body),
      PERFORMANCE_NEXT.note,
      ...PERFORMANCE_NEXT.items,
    ].flatMap(numbers);
    expect(shown.length).toBeGreaterThan(60);
    expect([...new Set(shown)].filter((n) => !doc.includes(n))).toEqual([]);
  });

  it("every number on the Testing page is in docs/testing.md", async () => {
    const doc = await readFile(path.join(repoRoot, TESTING_DOC), "utf8");
    const shown = [
      ...TESTING_LAYERS.flatMap((layer) => [layer.tests, layer.result, layer.time]),
      ...TESTING_COVERAGE.flatMap((row) => [row.lines, row.branches]),
      ...TESTING_POINTS.map((item) => item.body),
      ...TESTS_THAT_MATTER.flatMap((test) => [test.name, test.proves]),
    ].flatMap(numbers);
    expect(shown.length).toBeGreaterThan(20);
    expect([...new Set(shown)].filter((n) => !doc.includes(n))).toEqual([]);
  });

  it("the five named tests exist under those names", async () => {
    for (const test of TESTS_THAT_MATTER) {
      const source = await readFile(path.join(repoRoot, test.source.path), "utf8");
      expect(source.toLowerCase(), test.name).toContain(test.name.toLowerCase());
    }
  });

  it("both cards are live links now that the documents exist", () => {
    for (const kind of ["performance", "testing"]) {
      expect(existsSync(path.join(repoRoot, `docs/${kind}.md`))).toBe(true);
      expect(ARTIFACT_CARDS.find((card) => card.href === `/artifacts/${kind}`)?.pending).toBeUndefined();
    }
    expect(ARTIFACT_CARDS.some((card) => card.pending)).toBe(false);
  });
});

describe("evolution timeline", () => {
  it("reads the operator's merge list", () => {
    expect(MILESTONES.length).toBeGreaterThan(5);
    // Oldest first: dates never go backwards.
    for (let i = 1; i < MILESTONES.length; i += 1) expect(MILESTONES[i].date >= MILESTONES[i - 1].date, MILESTONES[i].hash).toBe(true);
    expect(MILESTONES.some((m) => /^merge:/.test(m.title))).toBe(true);
    expect(commitHref("6352d4e")).toBe("https://github.com/prakhar-parashar-au5/incubye_assignment/commit/6352d4e");
    expect(new Set(MILESTONES.map((m) => m.hash)).size).toBe(MILESTONES.length);
  });

  it.each([
    [{}, "must be an array"],
    [[{ hash: "XYZ1234", date: "2026-11-17", title: "t" }], "hash"],
    [[{ hash: "abc123", date: "2026-11-17", title: "t" }], "hash"],
    [[{ hash: "abc1234", date: "17-11-2026", title: "t" }], "date"],
    [[{ hash: "abc1234", date: "2026-11-17", title: "  " }], "title"],
    [[{ hash: "abc1234", date: "2026-11-17", title: "<script>".repeat(30) }], "title"],
  ])("rejects a malformed file (%j)", (raw, message) => {
    expect(() => readMilestones(raw)).toThrow(message);
  });
});
