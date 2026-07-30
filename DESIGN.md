---
name: Sredstva
description: An editorial public-data instrument for inspecting Croatian audiovisual funding.
colors:
  ink-dark: "#2e2522"
  paper-dark: "#f4ede2"
  paper-dim-dark: "#d6cebe"
  panel-dark: "#382b27"
  rule-dark: "#4a3b35"
  ink-light: "#f4ede2"
  paper-light: "#2a201d"
  paper-dim-light: "#5a4a42"
  panel-light: "#efe5d4"
  rule-light: "#d6cebe"
  muted: "#8a7e72"
  registry-red: "#c14843"
  analytics-red-dark: "#dc7069"
  analytics-red-light: "#a83b37"
typography:
  display:
    fontFamily: "Bricolage Grotesque, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Bricolage Grotesque, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Albert Sans, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "10px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.12em"
rounded:
  control: "2px"
  soft: "6px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button:
    backgroundColor: "{colors.ink-dark}"
    textColor: "{colors.paper-dark}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  button-active:
    backgroundColor: "{colors.registry-red}"
    textColor: "{colors.paper-dark}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  input:
    backgroundColor: "{colors.ink-dark}"
    textColor: "{colors.paper-dark}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
  chip:
    backgroundColor: "{colors.ink-dark}"
    textColor: "{colors.paper-dim-dark}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "6px 10px"
---

# Design System: Sredstva

## Overview

**Creative North Star: "The Public Ledger Desk"**

Sredstva should feel like a carefully edited working desk for public records: warm paper, dark ink, ruled divisions, exact figures, and restrained annotations. It is dense because its users compare evidence repeatedly, but hierarchy and progressive disclosure keep that density legible.

The interface is editorial, rigorous, and direct. It must never drift into a generic SaaS dashboard, a decorative metric-card grid, or a glossy visualization product. Interaction exists to help users investigate and verify, not to make public data feel theatrical.

**Key Characteristics:**

- Warm, tinted neutrals in both themes
- One red accent reserved for selection, focus, and consequential actions
- Editorial display type paired with a neutral body face and tabular mono labels
- Flat, ruled surfaces with depth used only for true overlays
- Compact information density with explicit provenance and exact values
- Responsive composition rather than a shrunken desktop layout

## Colors

The palette is a warm paper-and-ink system with registry red as a scarce editorial mark.

### Primary

- **Registry Red:** The sole action and selection accent. Use it for active filters, focus, selected chart marks, links, and important warnings.
- **Accessible Analytics Reds:** Theme-specific foreground variants carry small figures and chart strokes while preserving the Registry Red hue family.

### Neutral

- **Dark Ink and Dark Panel:** Base and raised surfaces in dark mode.
- **Dark Paper and Dim Paper:** Primary and secondary text in dark mode.
- **Light Ink and Light Panel:** Base and raised surfaces in light mode.
- **Light Paper and Dim Paper:** Primary and secondary text in light mode.
- **Rules and Muted Brown:** Dividers, inactive metadata, and quiet controls.

**The Red-Pencil Rule.** Registry red marks a decision or an active state. It is never ambient decoration and should occupy less than roughly ten percent of a screen.

**The Evidence-Is-Not-Color Rule.** Every chart color must be paired with a label, value, pattern, or position. Meaning must survive grayscale and common color-vision deficiencies.

## Typography

**Display Font:** Bricolage Grotesque (with system UI fallback)  
**Body Font:** Albert Sans (with system UI fallback)  
**Label/Mono Font:** JetBrains Mono (with UI monospace fallback)

**Character:** Bricolage supplies cultural personality only at major headings. Albert Sans stays quiet during reading and comparison. JetBrains Mono carries labels, amounts, formulas, dates, and provenance so numerical alignment remains stable.

### Hierarchy

- **Display** (800, 22px, 1.05): Product wordmark and major overlay titles.
- **Headline** (800, 18px, 1.15): Chapter and profile headings.
- **Title** (700, 14px, 1.25): Section titles and strong row labels.
- **Body** (400, 14px, 1.5): Explanations and narrative content, capped near 70ch.
- **Label** (500, 10px, 0.12em tracking, uppercase): Kicker labels, metadata, controls, and chart annotations.

**The Three-Voices Rule.** Bricolage speaks only for orientation, Albert Sans for reading, and JetBrains Mono for evidence. Never introduce another typographic voice for novelty.

## Elevation

The system is flat by default. Hierarchy comes from tonal layers, spacing, and one-pixel rules. Shadows are reserved for true overlays that detach from the registry; dark mode uses lighter surfaces rather than stronger shadows.

### Shadow Vocabulary

- **Overlay:** `0 40px 80px rgba(0,0,0,0.4)` for modal and full-screen overlay surfaces only.
- **Mobile Drawer:** `0 20px 40px rgba(0,0,0,0.34)` for the filter drawer only.

**The Flat-Ledger Rule.** If a section can be separated by space and a rule, it must not become a floating card.

## Components

### Buttons

- **Shape:** Compact rectangular controls with nearly square corners (2px).
- **Primary:** Transparent or ink-toned at rest; registry red is reserved for selected or consequential states.
- **Hover / Focus:** Shift border or text to registry red. Keyboard focus uses a visible two-pixel ring or equivalent border treatment.
- **Touch:** Preserve a minimum 44px target on coarse pointers even when the visible control is compact.

### Chips

- **Style:** Mono label, quiet border, pill shape only where a compact filter token benefits from it.
- **State:** Unselected chips remain neutral; selected chips use red border/text plus a non-color state marker when ambiguity is possible.

### Cards / Containers

- **Corner Style:** Square or nearly square.
- **Background:** Use the base and panel tones, not translucent glass.
- **Shadow Strategy:** None at rest.
- **Border:** One-pixel rule where a boundary is necessary.
- **Internal Padding:** Vary between 8px and 24px according to hierarchy; do not apply identical padding everywhere.

### Inputs / Fields

- **Style:** Transparent background, 1.5px rule, 2px corners, readable body text.
- **Focus:** Registry-red border with an unmistakable focus-visible treatment.
- **Error / Disabled:** State must be written and encoded beyond color; disabled controls retain readable contrast.

### Navigation

Navigation uses familiar tabs and chapter links. Active state is expressed through red rule/border, stronger text, and `aria-current` or selected semantics. Mobile chapter navigation becomes horizontally scrollable or a compact list without hiding destinations.

### Analytical Figures

Charts are editorial figures, not decorative panels. Every figure includes a direct title, exact readout, benchmark context, sample size, and accessible tabular equivalent. Interactive marks support pointer, keyboard, and touch.

## Do's and Don'ts

### Do:

- **Do** prioritize comparison and investigation over decoration.
- **Do** keep the registry dense, legible, and predictable for repeated use.
- **Do** distinguish global registry facts from the active filtered scope.
- **Do** connect important numbers to denominators, field coverage, methodology, and source evidence.
- **Do** use progressive disclosure for formulas, caveats, and detailed records.
- **Do** preserve bilingual content, light/dark/auto themes, visible focus, and reduced-motion behavior.

### Don't:

- **Don't** build a generic SaaS dashboard.
- **Don't** use decorative metric-card grids or leaderboard framing.
- **Don't** use glossy data visualizations or gratuitous motion.
- **Don't** conceal provenance, denominators, exact values, or field coverage.
- **Don't** use nested cards, glassmorphism, gradient text, or colored side-stripe accents.
- **Don't** make hover the only way to reveal information or perform an action.
- **Don't** use registry red as ambient decoration or rely on color alone for meaning.
