# Screenshot ledger

One 1440 × 1200 PNG per page in each theme: 15 pages, 30 assets. [`../social-preview.png`](../social-preview.png) (1280 × 640) is the repository's social card, built from `audit-dark.png`.

> [!NOTE]
> Every screenshot is captured from the synthetic demo database (`pnpm fixture:demo` → `test/fixtures/demo.db`) with documentation-only prices in an isolated config directory. No personal opencode database or real pricing configuration is ever read.

| Page | Route | Light | Dark |
| --- | --- | --- | --- |
| Overview | `/` | [`overview-light.png`](overview-light.png) | [`overview-dark.png`](overview-dark.png) |
| Activity | `/activity` | [`activity-light.png`](activity-light.png) | [`activity-dark.png`](activity-dark.png) |
| Sessions | `/sessions` | [`sessions-light.png`](sessions-light.png) | [`sessions-dark.png`](sessions-dark.png) |
| Session replay | `/sessions/<id>` (the demo session with a broken stream) | [`session-replay-light.png`](session-replay-light.png) | [`session-replay-dark.png`](session-replay-dark.png) |
| Projects | `/projects` | [`projects-light.png`](projects-light.png) | [`projects-dark.png`](projects-dark.png) |
| Project detail | `/projects/prj_billing` | [`project-detail-light.png`](project-detail-light.png) | [`project-detail-dark.png`](project-detail-dark.png) |
| Tools | `/tools` | [`tools-light.png`](tools-light.png) | [`tools-dark.png`](tools-dark.png) |
| Costs | `/costs` | [`costs-light.png`](costs-light.png) | [`costs-dark.png`](costs-dark.png) |
| Provider audit | `/audit` | [`audit-light.png`](audit-light.png) | [`audit-dark.png`](audit-dark.png) |
| Loops | `/loops` | [`loops-light.png`](loops-light.png) | [`loops-dark.png`](loops-dark.png) |
| Agents | `/agents` | [`agents-light.png`](agents-light.png) | [`agents-dark.png`](agents-dark.png) |
| Export | `/export` | [`export-light.png`](export-light.png) | [`export-dark.png`](export-dark.png) |
| Settings | `/settings` | [`settings-light.png`](settings-light.png) | [`settings-dark.png`](settings-dark.png) |
| Model pricing | `/settings/pricing` | [`pricing-light.png`](pricing-light.png) | [`pricing-dark.png`](pricing-dark.png) |
| Style guide | `/style-guide` | [`style-guide-light.png`](style-guide-light.png) | [`style-guide-dark.png`](style-guide-dark.png) |

## Reproducibility

The demo database is seeded and anchored to the day it is built, so the default 30-day views have data. Build it, then serve a production build against it with a temporary config directory:

```sh
pnpm fixture:demo
pnpm build
OC_LENS_DB="$PWD/test/fixtures/demo.db" XDG_CONFIG_HOME=/tmp/oc-lens-shots-config pnpm start -p 4173 -H 127.0.0.1
```

Give the three demo models (`anthropic/claude-sonnet-5`, `openai/gpt-5-mini`, `opencode/qwen3-coder`) nonzero documentation prices in `$XDG_CONFIG_HOME/oc-lens/config.json`, solely so cost pages show priced data.

Capture with headless Chromium driven by Playwright, one browser context per theme: a 1440×1200 viewport, `colorScheme` set to `light` or `dark`, and an init script that seeds `localStorage["oc-lens-theme"]` before the app's theme script runs. For each route, navigate with `waitUntil: "networkidle"`, wait a further ~900 ms for client-side data, and take a viewport screenshot. Load routes from the local loopback server only.

The PNGs are documentation, not visual-regression baselines. Regenerate them after a material layout change, and check that every file decodes as a PNG of the expected size before committing.
