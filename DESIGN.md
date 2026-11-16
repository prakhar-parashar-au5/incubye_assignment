---
name: ACME Compensation Manager
description: Calm HR operations interface for a synthetic-data compensation ledger.
colors:
  ground-off-white: "#f7f5f1"
  ink-navy: "#18233a"
  ink-muted: "#4a5467"
  surface-white: "#ffffff"
  hairline-warm: "#dcd7cd"
  field-edge: "#8c877c"
  muted-fill: "#ece8e0"
  accent-blue: "#2a57c0"
  accent-blue-hover: "#2249a3"
  accent-wash: "#e6ecf8"
  rail-navy: "#1a2740"
  rail-ink: "#eef1f6"
  rail-muted: "#aeb8ca"
  rail-line: "#33415c"
  rail-active: "#2b3a58"
  state-current: "#1d6e46"
  state-upcoming: "#8a5a00"
  state-historical: "#5f6673"
  error-red: "#b3261e"
  error-wash: "#fcf1f0"
typography:
  page-title:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  section-title:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  record:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.375
  credential:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.9375rem"
    fontWeight: 400
rounded:
  sm: "6px"
  md: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent-blue}"
    textColor: "{colors.surface-white}"
    rounded: "{rounded.sm}"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.accent-blue-hover}"
  button-outline:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.ink-navy}"
    rounded: "{rounded.sm}"
    height: "36px"
  button-rail:
    backgroundColor: "{colors.rail-navy}"
    textColor: "{colors.rail-ink}"
    rounded: "{rounded.sm}"
    height: "36px"
  input:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.ink-navy}"
    rounded: "{rounded.sm}"
    height: "40px"
  nav-item-current:
    backgroundColor: "{colors.rail-active}"
    textColor: "{colors.rail-ink}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
---

# DESIGN.md

Recorded from the built Frontend Task 01 surfaces (`/sign-in`, `/employees`) on 2026-11-15. Tokens live in `next-frontend/src/app/globals.css`.

## Overview

An Operate surface: HR managers come to find and check compensation records, so the interface uses familiar web controls and spends its character on palette, density, and one signature element. The visual direction is pinned by `docs_human/09-frontend-directory.md`: warm off-white ground, navy ink, one restrained blue, state colours with text labels, no gradients, no glass, no card wall, minimal motion. Light only; the use scene is an office desk in daylight.

**Signature element: the access record.** Role and access scope set as one ruled line with two fixed columns (`Role | Access`). It appears on each sign-in account and in the signed-in identity block, so the access a person is about to use and the access they are using look the same.

**Shared shell.** The sign-in page and the application use the same navy rail on desktop (17rem) and the same compact navy header on mobile, so both read as one product.

## Colors

- `ground-off-white` is the page. `surface-white` is for fields, panels, and selectable rows on that ground. `hairline-warm` draws rules and panel edges.
- `ink-navy` is all primary text. `ink-muted` is secondary text (7:1 on the ground).
- `accent-blue` is the only accent: primary actions, the current selection, focus outlines, and the permission icon. `accent-wash` backs informational notices and the selected sign-in row.
- The rail family (`rail-*`) owns the shell band only.
- `state-current`, `state-upcoming`, `state-historical` are reserved for compensation and employment states, always next to the words Current, Upcoming, Historical. Not yet used on a built surface.
- `error-red` and `error-wash` are for errors and destructive actions only.
- `field-edge` gives inputs and outline buttons a 3.4:1 edge against white (WCAG 1.4.11).

## Typography

One family, Public Sans, self-hosted by `next/font`. A fixed rem scale with small steps: page title 1.75rem semibold, section titles 0.9375rem semibold, body 0.875–0.9375rem, records and labels 0.8125rem. Sentence case everywhere, matching the approved copy. Monospace appears only for the literal demo credential value. Headings use `text-wrap: balance`; paragraphs `pretty`.

## Layout

- Desktop (≥1024px): `17rem` rail plus a fluid main column with 48px side padding. Forms cap at 34rem; page headings at 48rem.
- Mobile: navy header with the product name and a `Menu` disclosure (`<details>`), then the identity record, then content at 16px side padding.
- Space: tight groups (8px), field groups 32px apart, section panels 32px below the heading block.

## Elevation & Depth

Flat. Panels are separated by hairlines, not shadows. Shadows mark overlays only: the mobile menu panel (offset 12px, blur 24px) and the filter sheet (blur 32px over a 35% navy scrim, no backdrop blur).

## Shapes

`rounded.sm` (6px) on controls and rows; `rounded.md` (8px) on panels and alerts. No pills.

## Components

- **Buttons:** shadcn/ui base-nova, adapted. Explicit colour transitions (150ms), no `transition-all`. Variants: primary, outline, rail (on navy), link.
- **Inputs:** 40px, white, `field-edge` border, blue border on focus plus the global focus outline.
- **Selectable account row:** native radio inside a full-row label, white on the ground; selected row gets the blue edge and `accent-wash`. The radio's accessible name is the person; the role and access are its description.
- **Alerts:** info (`accent-wash`) and destructive (`error-wash`) only. Message plus the recovery action.
- **Placeholders:** static skeleton bars without pulse, always paired with status text that says what the area is waiting for.
- **Directory table (desktop ≥1024px):** 13px body, 12px headers, 10px cell padding, hairline rows. Sortable headers are links with `aria-sort` and a small arrow (blue when active). Money columns are right-aligned. Below 1440px the table scrolls inside its own focusable region; the page never scrolls sideways.
- **Directory list (mobile):** one ruled list item per employee: name link and ID, department and status, then base salary and the USD figure side by side, then the compensation state.
- **Money:** `INR 25,00,000.00` (Indian grouping) or `USD 120,000.00`; currency code always, tabular figures, never wrapped. USD equivalents are secondary, and the rate (value, effective date, linked source) is stated beside them: above the table for salary sorts, as a footnote otherwise.
- **Compensation state:** a 6px dot in the state colour plus the words Current, Upcoming from <date>, Historical, or Last recorded compensation. The dot never appears without the words.
- **Filters:** native selects (`NativeSelect`) with visible labels and "All" as the empty choice. Desktop applies on change; mobile collects choices in a right-hand sheet (Base UI Dialog: focus trap, Escape, focus return, page behind made inert) and applies on "Apply". Active filters are removable link chips plus "Clear all".
- **Navigation:** the current item is a link with `rail-active` fill and `aria-current="page"`. Unbuilt sections are plain text with a "Coming later" label, never links or buttons.
- **Focus:** a 2px outline, 2px offset, in `accent-blue`; `rail-ink` on the rail.

## Do's and Don'ts

- Do show where access comes from: the access record on sign-in and in the shell, and the permission-filtered notice for Scoped HR.
- Do pair every state colour with its text label.
- Do keep unbuilt features non-interactive.
- Don't add eyebrow labels above headings, gradient text, glass, coloured side borders on cards, or decorative motion.
- Don't use animated skeletons for areas that are not actually loading.
- Don't introduce a second accent colour.

Not canonized: the Impeccable detector's `cream-palette` warning on the ground colour. The ground is kept because the approved brief pins a warm off-white; it is a brief decision, not a house default for new surfaces outside this product.
