# Screenshot ledger

This is the complete screenshot inventory for the 15 shipped pages: one 1440 × 1200 PNG in each theme, for 30 assets total.

> [!NOTE]
> **Capture status: complete; 30 of 30 assets committed (2026-08-02).** Captured from `pnpm dev` bound to loopback, using the deterministic `test/fixtures/populated.db` and an isolated `XDG_CONFIG_HOME` pricing file with documentation-only rates (see Reproducibility below). No personal opencode database or real pricing configuration was read.

| Page | Route captured | Light asset | Dark asset |
| --- | --- | --- | --- |
| Overview | `/` | [`overview-light.png`](overview-light.png) | [`overview-dark.png`](overview-dark.png) |
| Activity | `/activity` | [`activity-light.png`](activity-light.png) | [`activity-dark.png`](activity-dark.png) |
| Sessions | `/sessions` | [`sessions-light.png`](sessions-light.png) | [`sessions-dark.png`](sessions-dark.png) |
| Session replay | `/sessions/ses_0000` | [`session-replay-light.png`](session-replay-light.png) | [`session-replay-dark.png`](session-replay-dark.png) |
| Projects | `/projects` | [`projects-light.png`](projects-light.png) | [`projects-dark.png`](projects-dark.png) |
| Project detail | `/projects/proj_infra` | [`project-detail-light.png`](project-detail-light.png) | [`project-detail-dark.png`](project-detail-dark.png) |
| Tools | `/tools` | [`tools-light.png`](tools-light.png) | [`tools-dark.png`](tools-dark.png) |
| Todos | `/todos` | [`todos-light.png`](todos-light.png) | [`todos-dark.png`](todos-dark.png) |
| Costs | `/costs` | [`costs-light.png`](costs-light.png) | [`costs-dark.png`](costs-dark.png) |
| Agents | `/agents` | [`agents-light.png`](agents-light.png) | [`agents-dark.png`](agents-dark.png) |
| Subagent tree | `/agents/tree` | [`subagent-tree-light.png`](subagent-tree-light.png) | [`subagent-tree-dark.png`](subagent-tree-dark.png) |
| Export | `/export` | [`export-light.png`](export-light.png) | [`export-dark.png`](export-dark.png) |
| Settings | `/settings` | [`settings-light.png`](settings-light.png) | [`settings-dark.png`](settings-dark.png) |
| Model pricing | `/settings/pricing` | [`pricing-light.png`](pricing-light.png) | [`pricing-dark.png`](pricing-dark.png) |
| Style guide | `/style-guide` | [`style-guide-light.png`](style-guide-light.png) | [`style-guide-dark.png`](style-guide-dark.png) |

## Reproducibility

Start the capture server against an absolute fixture path and a temporary `XDG_CONFIG_HOME`, never the default database or pricing locations:

```sh
pnpm fixture
OC_LENS_DB="$PWD/test/fixtures/populated.db" XDG_CONFIG_HOME=/tmp/oc-lens-shots-config pnpm dev --port 4173
```

Give the six fixture models (`opencode/deepseek-v4-flash-free`, `opencode/qwen3-coder`, `anthropic/claude-sonnet-5`, `anthropic/claude-haiku-4-5`, `openai/gpt-5-mini`, `google/gemini-2.5-pro`) deterministic nonzero USD-per-million-token rates in `$XDG_CONFIG_HOME/oc-lens/config.json` solely so every cost-capable page demonstrates priced data.

Capture with a headless Chromium driven by Playwright (`pip install playwright && playwright install chromium`), one browser context per theme: a 1440×1200 viewport, `color_scheme` set to `light`/`dark` so `prefers-color-scheme` resolves correctly, and an `add_init_script` that seeds `localStorage["oc-lens-theme"]` before the app's own theme script runs. For each of the 15 routes, navigate with `wait_until="networkidle"`, wait an additional ~600ms for client-side data fetches to settle, then screenshot to PNG. Load each route from the local loopback server only.

The PNGs are documentation artifacts, not visual-regression baselines. Regenerate the full ledger after a material shipped-page layout change, and verify every file is a decoded PNG of the expected dimensions before committing it.
