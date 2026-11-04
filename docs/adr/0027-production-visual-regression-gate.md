---
Status: accepted
---

# Production UI visual regression is a release gate

## Context

The signed-off prototype is the visual and interaction baseline, but prototype screenshots do not prove that production pages match it. The UI parity matrix already requires production routes, real actions, page states, four viewport sizes and author sign-off. The missing contract is the repeatable screenshot-comparison procedure and its tolerance.

## Decision

- Each of the 17 production page contracts owns four production Golden Screenshots at 390, 900, 1180 and 1440 CSS pixels wide.
- Golden images are captured only from the real production Web application using a pinned Playwright/Chromium version, pinned fonts and deterministic fixture data. Prototype images remain reference inputs; they are never copied into the production golden directory.
- Visual tests must wait for document.fonts.ready, disable CSS/Web Animations, hide the text caret, use a fixed locale/timezone and use the same screenshot mode and viewport for the expected and actual images.
- The initial page baseline requires an author comparison and explicit sign-off. Subsequent visual changes require an updated baseline and approval in the same PR; unapproved drift fails CI.
- Default pixel tolerance is maxDiffPixelRatio: 0.005 (0.5%) per page/viewport screenshot. This is a rendering-noise tolerance, not permission to redesign or change layout. Semantic structure, text, route, action, state and responsive assertions remain mandatory and cannot be waived by a passing pixel ratio.
- Dynamic regions may be masked only when deterministic fixture data cannot eliminate the variation. Every mask must be listed in the page test with a reason; manuscript content, controls, status, prices/costs, errors and other meaningful product data must never be masked.
- CI must retain expected, actual and diff images plus the Playwright report when a visual comparison fails.
- A visual change that alters hierarchy, navigation, primary action placement, interaction, required state or responsive behavior is a product deviation, not a harmless screenshot update. It requires updating the prototype, prototype contract, parity matrix and sign-off record before production implementation.

## Consequences

- UI parity becomes reproducible and reviewable rather than a subjective assertion.
- A page is parity-verified only after its real actions, required states, four viewport tests, screenshot comparison and author-language scan pass.
- The required implementation paths and procedures are in docs/ui/production-visual-regression.md.
