# M3-07b-02a dashboard metrics and filters

Issue: #245

## Persisted projection

The work-list contract exposes a **main creation line** summary under `metrics` without changing the single-work overview contract. Dashboard cards label this scope as `主线`; parallel versions remain independent and are not mixed into one work-level total.

- `totalWordCount`: sum of `chapters.word_count` on the work's `main` branch.
- `progress.writtenChapters`: main-branch chapters with `word_count > 0`.
- `progress.plannedChapters`: the greater of main-branch chapter rows and distinct chapter-level outline nodes referencing a chapter.
- `progress.percent`: `round(writtenChapters / plannedChapters * 100)`, capped by the shared contract at 0-100; zero planned chapters reports zero.
- `qualityScore`: latest quality report attached to each current chapter version; each report's six dimension scores are averaged and multiplied by 20, then chapter scores are averaged and rounded. No current-version report reports `null`.
- `unrecoveredForeshadowCount`: non-deleted `foreshadows` in `planned`, `planted`, `progressed` or `deferred`.
- `lastEditedAt`: latest of the work row, main branch row, chapters, outline nodes, foreshadows, non-deleted settings entities, story-bible versions and volume contracts on the main branch.

## Filters

- `words=lt1m|1m-2m|gt2m`: persisted total word count below 1,000,000, from 1,000,000 to below 2,000,000, or at least 2,000,000.
- `recent=day|week|month`: `lastEditedAt` within 24, 168 or 720 hours.
- `status=preparing`: groups `draft` and `preparing`, matching the author-facing `筹备中` label.

Both filters are applied before cursor pagination.

## Evidence

- API integration: `apps/api/test/works.integration.test.ts`
  - `projects dashboard progress, word count, quality and open foreshadows from persisted data`
  - `filters works by persisted word count and last edit time`
- Dashboard owner Playwright: `apps/web/e2e/parity/dashboard.spec.ts`
  - `shows persisted metrics and filters by word count and last edit`
- Linux/Chromium candidates: `artifacts/ui/candidates/m3-245-dashboard/`
  - Author-approved at 390, 900, 1180 and 1440; hashes and signoff are recorded in `docs/ui/v1-prototype-signoff.md`.
  - Formal files: `artifacts/ui/golden/dashboard/dashboard-{390,900,1180,1440}.png`.

