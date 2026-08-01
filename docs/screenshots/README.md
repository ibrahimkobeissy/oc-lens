# Screenshot ledger

This is the complete planned screenshot inventory for the 15 shipped pages: one 1440 × 1200 PNG in each theme, for 30 assets total.

> [!WARNING]
> **Capture status: blocked; 0 of 30 assets exist.** On 2026-08-01 the sandbox rejected the fixture-backed loopback server with `listen EPERM: operation not permitted 127.0.0.1:43131`. The required escalated execution was then rejected because the execution-approval usage limit was exhausted until 2026-08-08 13:05 Europe/Paris. No placeholder, copied image, or fabricated capture has been committed. OCL-131 cannot satisfy its screenshot acceptance criterion until the real captures are produced.

When capture is unblocked, use the deterministic `test/fixtures/populated.db`, the fixture's stable `ses_0000` and `proj_infra` detail records, and an isolated local pricing file with explicit documentation-only rates. Do not read a personal opencode database or real pricing configuration.

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

Start the capture server against an absolute fixture path and a temporary `XDG_CONFIG_HOME`, never the default database or pricing locations. Give the six fixture models deterministic nonzero USD-per-million-token rates solely so every cost-capable page demonstrates priced data. Run Firefox headlessly with isolated light and dark profiles, and load each route from the local loopback server.

The PNGs are documentation artifacts, not visual-regression baselines. Regenerate the full ledger after a material shipped-page layout change, and verify every file is a decoded PNG of the expected dimensions before committing it.
