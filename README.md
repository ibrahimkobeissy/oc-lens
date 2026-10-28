<p align="center">
  <img src="docs/social-preview.png" alt="oc-lens — see where your opencode tokens really go" width="100%">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/oc-lens"><img src="https://img.shields.io/npm/v/oc-lens?color=2563eb&label=npm" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-0ea5e9" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/node-22%20%7C%2024%20%7C%2026-16a34a" alt="Node.js 22, 24 or 26">
  <img src="https://img.shields.io/badge/runs-100%25%20local-7c3aed" alt="Runs 100% locally">
</p>

<p align="center">
  <b>Local, read-only analytics for your <a href="https://opencode.ai/">opencode</a> history.</b><br>
  Find the loops, the provider failures, and the tokens you paid for without noticing.
</p>

```sh
npx oc-lens
```

That's it — it finds your opencode database, opens a dashboard in your browser, and never writes a byte to your history.

---

## Why

opencode keeps everything in one SQLite file. oc-lens turns it into answers:

- **Where did the agent loop?** The same failing command run four times, the same file re-read for nothing, an edit undone and redone.
- **What did my provider cost me?** Rate limits, provider outages, streams that broke after the provider accepted the request, the retries opencode hides inside a step, and the cache price lost when a call has to be resent.
- **Where do the tokens go?** By day, model, project, agent, and session — priced with *your* rates, never a guessed table.

`opencode web` is for working in sessions and `opencode stats` is a terminal summary; oc-lens is the history analysis neither of them does.

## Highlights

### Provider audit

Every failed model call, the resends that followed, and what they added: tokens recorded on failed calls, context paid at full price because the cache was lost, calls the model redid — and an estimate for requests the provider accepted (HTTP 200) but opencode never recorded usage for. **Slow starts** flag steps that waited far longer than usual for the first token: the only trace opencode leaves of retries that eventually succeeded.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/audit-dark.png">
  <img src="docs/screenshots/audit-light.png" alt="Provider audit: failed calls, resends, cache lost, and requests accepted but never recorded">
</picture>

### Loop detection

A loop is the *same* call repeated — matched on tool name and a hash of its input, never on the tool name alone. Reading five different files is ordinary work and is never reported; a test re-run four times with the same failure is.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/loops-dark.png">
  <img src="docs/screenshots/loops-light.png" alt="Loops: error retries and redundant repeats, each linked into the replay">
</picture>

### Session replay

Every turn, tool call, and token count — with failed calls, resends, slow starts, and loops marked in place, and a turn list that flags them at a glance. Export a single session in the format `opencode session import` reads.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/session-replay-dark.png">
  <img src="docs/screenshots/session-replay-light.png" alt="Session replay with collapsible panels for file changes, slow starts, failures, loops, and token usage">
</picture>

### And the rest

| | |
| --- | --- |
| **Overview & activity** | KPIs, streaks, calendar heatmap, hourly and weekday patterns |
| **Sessions** | Search and filter your whole history, newest first |
| **Costs** | Totals and trends by model, project, and agent, plus a daily usage table — from your prices only |
| **Projects & agents** | Per-project and per-agent tokens, cost, and tool mix |
| **Tools** | Rankings, durations, error rates, MCP servers, and skills |
| **Export** | Local JSON or ZIP of any dataset and date range |

## Honest numbers

oc-lens would rather say "I don't know" than show you a wrong figure:

- **Cost comes from your prices.** opencode's stored `cost` is often `0`; oc-lens prices tokens with the per-million rates you enter in **Settings → Pricing**. Until a model is priced, its totals say **not priced** — never `$0.00`.
- **Estimates say so.** Resend and loop costs are upper bounds; tokens in requests opencode never recorded are labelled estimates.
- **Unknowns stay visible.** Missing agents and models get an explicit `unknown` bucket, and a database schema oc-lens does not recognise is refused rather than misread.

## Private by design

- The opencode database is opened **read-only**. No route writes to opencode's database, configuration, or session files.
- Credential tables and auth files are never read.
- The server listens on **loopback only**. No account, no cloud, no telemetry.
- The one thing oc-lens writes is your own price list, at `~/.config/oc-lens/config.json`.

The full threat boundary and the tests that enforce it are in [SECURITY.md](SECURITY.md).

## Usage

```text
npx oc-lens [options]

  --port <port>  Bind exactly this loopback port (default: first free from 3000)
  --db <path>    Use only this opencode database path
  --no-open      Do not open a browser
  --help, -h     Show help
  --version, -v  Show the package version
```

Without `--db`, oc-lens looks at `OC_LENS_DB`, then `$XDG_DATA_HOME/opencode/opencode.db`, then `~/.local/share/opencode/opencode.db`.

**Requirements:** Node.js 22.23.4+, 24.22.1+, or 26.12.1+ (earlier releases are affected by Node2Shell, CVE-2026-111497, so the CLI refuses to start on them). Verified against opencode **1.17.7** and **2.x** databases, including 1.x databases upgraded to 2.x.

## Screenshots

<details>
<summary><b>Every page, light and dark</b> — captured from a synthetic demo database, never real history</summary>

| Page | Light | Dark |
| --- | --- | --- |
| Overview | [![Overview, light](docs/screenshots/overview-light.png)](docs/screenshots/overview-light.png) | [![Overview, dark](docs/screenshots/overview-dark.png)](docs/screenshots/overview-dark.png) |
| Activity | [![Activity, light](docs/screenshots/activity-light.png)](docs/screenshots/activity-light.png) | [![Activity, dark](docs/screenshots/activity-dark.png)](docs/screenshots/activity-dark.png) |
| Sessions | [![Sessions, light](docs/screenshots/sessions-light.png)](docs/screenshots/sessions-light.png) | [![Sessions, dark](docs/screenshots/sessions-dark.png)](docs/screenshots/sessions-dark.png) |
| Session replay | [![Session replay, light](docs/screenshots/session-replay-light.png)](docs/screenshots/session-replay-light.png) | [![Session replay, dark](docs/screenshots/session-replay-dark.png)](docs/screenshots/session-replay-dark.png) |
| Projects | [![Projects, light](docs/screenshots/projects-light.png)](docs/screenshots/projects-light.png) | [![Projects, dark](docs/screenshots/projects-dark.png)](docs/screenshots/projects-dark.png) |
| Project detail | [![Project detail, light](docs/screenshots/project-detail-light.png)](docs/screenshots/project-detail-light.png) | [![Project detail, dark](docs/screenshots/project-detail-dark.png)](docs/screenshots/project-detail-dark.png) |
| Tools | [![Tools, light](docs/screenshots/tools-light.png)](docs/screenshots/tools-light.png) | [![Tools, dark](docs/screenshots/tools-dark.png)](docs/screenshots/tools-dark.png) |
| Costs | [![Costs, light](docs/screenshots/costs-light.png)](docs/screenshots/costs-light.png) | [![Costs, dark](docs/screenshots/costs-dark.png)](docs/screenshots/costs-dark.png) |
| Provider audit | [![Provider audit, light](docs/screenshots/audit-light.png)](docs/screenshots/audit-light.png) | [![Provider audit, dark](docs/screenshots/audit-dark.png)](docs/screenshots/audit-dark.png) |
| Loops | [![Loops, light](docs/screenshots/loops-light.png)](docs/screenshots/loops-light.png) | [![Loops, dark](docs/screenshots/loops-dark.png)](docs/screenshots/loops-dark.png) |
| Agents | [![Agents, light](docs/screenshots/agents-light.png)](docs/screenshots/agents-light.png) | [![Agents, dark](docs/screenshots/agents-dark.png)](docs/screenshots/agents-dark.png) |
| Export | [![Export, light](docs/screenshots/export-light.png)](docs/screenshots/export-light.png) | [![Export, dark](docs/screenshots/export-dark.png)](docs/screenshots/export-dark.png) |
| Settings | [![Settings, light](docs/screenshots/settings-light.png)](docs/screenshots/settings-light.png) | [![Settings, dark](docs/screenshots/settings-dark.png)](docs/screenshots/settings-dark.png) |
| Pricing | [![Pricing, light](docs/screenshots/pricing-light.png)](docs/screenshots/pricing-light.png) | [![Pricing, dark](docs/screenshots/pricing-dark.png)](docs/screenshots/pricing-dark.png) |
| Style guide | [![Style guide, light](docs/screenshots/style-guide-light.png)](docs/screenshots/style-guide-light.png) | [![Style guide, dark](docs/screenshots/style-guide-dark.png)](docs/screenshots/style-guide-dark.png) |

How they are made: [docs/screenshots/README.md](docs/screenshots/README.md).
</details>

## Contributing

```sh
pnpm install
pnpm fixture:demo
OC_LENS_DB="$PWD/test/fixtures/demo.db" pnpm dev
```

The demo and test databases are synthetic and deterministic — tests never touch a real opencode history. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request; [project-docs/opencode-data-model.md](project-docs/opencode-data-model.md) records every opencode data shape oc-lens relies on, and the evidence for it.

## License

[MIT](LICENSE). The information architecture was inspired by [cc-lens](https://github.com/Arindam200/cc-lens) (also MIT); oc-lens is an independent implementation against opencode's data model.
