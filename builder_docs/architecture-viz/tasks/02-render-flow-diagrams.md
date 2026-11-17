# Architecture viz task 02: render each flow as one static page

## Status

BLOCKED until Task 01 is accepted.

## Goal

Make one simple, good-looking picture per flow: a single thread from the button click to the API, the functions, the database, and back to the screen. It is a static picture, not a video and not an interactive app.

## Build

Write a small script, `architecture-viz/render.ts`. It reads `architecture-viz/flows/*.json` and writes, for each flow:
- `architecture-viz/out/<flow>.html`: one self-contained file with inline CSS and no JavaScript framework. It opens directly in a browser.
- `architecture-viz/out/<flow>.png`: a full-page screenshot of that HTML, made with Playwright, which the repo already has.

Nodes are never hard-coded. Everything comes from the JSON.

## Layout

- **Thread.** One vertical thread, read top to bottom. The step number sits on the line, and the edge `label` sits next to it. The `payload` shape goes in a small grey monospace line under the label.
- **Lanes.** Show each lane as a narrow column, or as a coloured tag on each node: Browser, Next server, Express, MySQL, OpenAI. The thread moves between columns as the request crosses layers.
- **Node shapes:**
  - a function is a rounded card that shows `symbol` in monospace and `file:line` in small text;
  - a database table is a cylinder that shows the table name and SELECT/INSERT/UPDATE;
  - OpenAI is a hexagon;
  - the button click is a pill at the top;
  - the final screen is a pill at the bottom.
- **The return path** (response → validation → render) uses a dashed line, so the way down and the way back are easy to tell apart.
- **Alternatives** (the Scoped filter, a 401, a model failure, a rejected tool) are small side notes next to the step where they branch. They do not get their own threads.
- **Header:** the flow title and one sentence. **Footer:** the commit ID and "Generated from flows/<file>.json".

## Look

- Use the product palette from `DESIGN.md`, on a light background.
- Use one sans font and one monospace font.
- Each lane has its own subtle tint. All database cylinders share one accent colour, and OpenAI has a second accent.
- No gradients and no emoji.
- The page must stay readable when printed or when shown on a 1440 px wide screen.

## Checks

- `render.ts` runs with one command, for example `npx tsx architecture-viz/render.ts`, and writes both HTML and PNG files for F1 and F2.
- Open each HTML file and check it by eye.
- Copy the two PNG files into `builder_docs/architecture-viz/responses/evidence-02/`.

## Rules

- Change nothing outside `architecture-viz/` and its response docs.
- No Git, no `.env`.
- If the flow JSON looks wrong, report it. Do not edit it.

Write `builder_docs/architecture-viz/responses/02-render-flow-diagrams.md` and stop.
