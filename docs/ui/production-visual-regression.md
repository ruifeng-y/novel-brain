# Production UI Visual Regression Contract

> Status: accepted implementation contract under ADR 0027.
> Page ownership and required screenshot paths: docs/ui/v1-ui-parity-matrix.md.
> Prototype references: prototype/screens/v1-baseline/.
> Production artifacts: artifacts/ui/golden/.

## 1. Required coverage

- 17 production page contracts × 4 viewport widths = 68 production Golden Screenshots.
- Viewport widths: 390, 900, 1180 and 1440 CSS pixels. Use the page-specific height fixed in the test fixture; do not resize based on content.
- Capture the real production route with a deterministic, version-pinned fixture. A static prototype, storybook-only rendering, mock page or screenshot copied from the prototype is not production evidence.
- Keep semantic Playwright assertions for page route, page title, primary actions, visible states, text and no-horizontal-overflow. Screenshot assertions supplement these tests; they do not replace them.

## 2. Deterministic rendering environment

Pin and record:

- Playwright package and Chromium browser revision.
- CI operating system/image and installed font files.
- Locale, timezone, color scheme, reduced-motion preference and device scale factor.
- Fixture seed, selected work/branch, content, timestamps, task states and model/provider display values.
- Screenshot mode (full page or viewport) and viewport height per page.

Before capture, wait for application readiness and document.fonts.ready. Disable CSS/Web Animations, hide caret and freeze time/random fixture values. Avoid transitions, blinking carets, rotating content and network-loaded external assets in the captured state.

Suggested Playwright assertion (keep the same screenshot options for actual and expected images):

- animations: disabled
- caret: hide
- scale: css
- maxDiffPixelRatio: 0.005

The current M0 baseline is rendered with Playwright 1.64.1 Chromium in the
`Production CI` `ubuntu-24.04` job, locale `zh-CN`, timezone `Asia/Shanghai`,
light color scheme, reduced motion, device scale factor 1 and fixed API
timestamps. The approved baseline evidence is
[Production CI #42005502769](https://github.com/ruifeng-y/novel-brain/actions/runs/42005502769).
Changing the runner image, font packages or browser revision requires a new
controlled baseline update and author approval.

The repository's installed Playwright version must be used consistently; do not silently upgrade the browser or screenshot renderer while refreshing baselines.

## 3. Tolerance and masks

- Default maximum difference is 0.5% of screenshot pixels for each page/viewport pair (maxDiffPixelRatio: 0.005).
- A ratio within tolerance does not approve a changed layout. Semantic assertions, required action tests and author sign-off still apply.
- Do not increase tolerance globally to make a failing page pass. A page-specific exception requires a documented reason and approval.
- Prefer deterministic fixtures over masks. A mask is allowed only for an unavoidable non-deterministic region and must be declared in the page test with a reason.
- Never mask primary content, editor text, setting values, chapter status, cost/usage values, errors, buttons, navigation or authorization state.

## 4. Baseline lifecycle

1. Implement the production page and its real API/Worker actions.
2. Run the page's Playwright route/action/state tests at all four viewports.
3. Capture candidate screenshots to the page's declared golden path.
4. Compare candidate screenshots with the signed-off prototype baseline; resolve structural, hierarchy, wording, responsive and interaction differences.
5. Obtain explicit author sign-off for the initial production baseline.
6. Commit the four production Golden Screenshots and link the artifacts and sign-off in the owning issue.
7. Thereafter, every PR that changes a page, shared component, design token or relevant behavior runs affected visual tests. An intentional baseline change must include updated images, diff artifacts and approval evidence in the same PR.

The controlled update command is `pnpm test:e2e:update`. In CI, the `Production CI` workflow exposes the same operation through the `update_golden` workflow-dispatch input and uploads the regenerated `artifacts/ui/golden/` files as evidence. Normal pull-request runs never update baselines automatically.

## 5. CI failure artifacts

On visual mismatch, retain:

- Expected screenshot.
- Actual screenshot.
- Pixel-diff image.
- Playwright HTML report and trace where available.
- Commit SHA, fixture manifest, browser revision and page/viewport identifier.

CI must fail on a visual mismatch beyond tolerance or on any semantic/action/state assertion failure. Missing expected screenshots are failures, not permission to create new baselines automatically.

## 6. Parity status

A page can become parity-verified only when all applicable page actions call real production API/Worker behavior, required states and recovery paths pass, four viewport tests pass, screenshot comparison passes, author-language scan passes and the author has signed off the initial production golden.

An approved product deviation must update the prototype, docs/ui/prototype-contract.md, docs/ui/v1-ui-parity-matrix.md, screenshot baseline and sign-off record. A pixel-only update must never be used to silently approve a product redesign.
