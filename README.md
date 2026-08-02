# oc-lens

Local, read-only analytics for your [opencode](https://opencode.ai/) history.

> [!IMPORTANT]
> oc-lens opens opencode's SQLite database in read-only mode. It never writes to the database, opencode configuration, or session files. Its only write is your optional model-price configuration at `~/.config/oc-lens/config.json`. See [SECURITY.md](SECURITY.md) for the enforced guarantees.

`opencode web` is the browser interface for working with live sessions, and `opencode stats` is a terminal summary. oc-lens complements them with history analytics: activity and streaks, token and user-priced cost trends, project and agent breakdowns, tool adoption and failures, todos, subagent trees, exports, and conversation replay.

Everything runs on your machine. There is no account, cloud sync, or telemetry.

## Requirements

- Node.js 22.5 or newer
- An opencode SQLite database (normally `~/.local/share/opencode/opencode.db`)
- Model prices you enter yourself if you want cost figures

oc-lens is verified against the database schema produced by **opencode 1.17.7** (`opencode-1.17.7`). A schema guard checks required tables and columns before analytics run. If the database is missing, the UI shows the locations it checked. If its schema differs, the UI reports that the database is incompatible and refuses to render potentially wrong numbers; update oc-lens to a compatible release instead of trusting partial results.

## Install and run

Run the published CLI without installing it globally:

```sh
npx oc-lens
```

The dashboard binds only to loopback (`127.0.0.1`), starts on the first free port from 3000, and opens your browser. Available flags:

```text
Usage: oc-lens [options]

Options:
  --port <port>  Bind exactly this loopback port (default: first free from 3000)
  --db <path>    Use only this opencode database path
  --no-open      Do not open a browser
  --help, -h     Show help
  --version, -v  Show the package version
```

Examples:

```sh
# Use a specific database without changing it
npx oc-lens --db /absolute/path/to/opencode.db

# Choose an exact port and leave browser opening to you
npx oc-lens --port 4313 --no-open
```

When `--db` is omitted, discovery checks `OC_LENS_DB`, then `$XDG_DATA_HOME/opencode/opencode.db`, then `~/.local/share/opencode/opencode.db`.

## Set up honest cost analytics

opencode's stored `cost` field is not treated as your bill: some providers report zero and arbitrary providers cannot be priced accurately from a bundled table. oc-lens calculates user cost only from prices you supply.

1. Open **Settings → Model pricing**.
2. Review the `providerID/modelID` values observed in your database and their token volumes.
3. Enter your provider's current USD price per one million tokens for input, output, cache-read, and cache-write tokens.
4. Save. Cost cards, charts, projects, agents, sessions, replay, and exports use the same local pricing configuration.

Until every model involved has a price, affected totals say **not priced** or identify unpriced models; they do not silently become `$0.00`. Provider-reported stored cost remains separately labelled for comparison. Prices stay local in `~/.config/oc-lens/config.json`, the product's single sanctioned write path.

## Features

- Overview KPIs, recent sessions, project/model breakdowns, and activity heatmap
- Calendar activity, streaks, hourly and weekday patterns
- Searchable/filterable session history and detailed conversation replay
- Project portfolio and per-project activity, model, token, and cost analytics
- Tool rankings, durations, error analysis, MCP usage, skills, adoption, and version history
- Native opencode todo browsing and status filters
- Cost trends by model, project, and agent using your prices
- Agent usage, handoffs, and nested subagent trees
- Local JSON/ZIP export with cancellation and progress
- Redacted environment settings and editable local pricing
- Empty, sparse, populated, missing-database, and schema-mismatch states
- Persistent light and dark themes

## Screenshots

The complete 15-route, 30-asset ledger is in [docs/screenshots/README.md](docs/screenshots/README.md), captured against the deterministic fixture database with documentation-only pricing — never a personal opencode database or real pricing configuration.

| Page | Light | Dark |
| --- | --- | --- |
| Overview (`/`) | [![Overview in light theme](docs/screenshots/overview-light.png)](docs/screenshots/overview-light.png) | [![Overview in dark theme](docs/screenshots/overview-dark.png)](docs/screenshots/overview-dark.png) |
| Activity (`/activity`) | [![Activity in light theme](docs/screenshots/activity-light.png)](docs/screenshots/activity-light.png) | [![Activity in dark theme](docs/screenshots/activity-dark.png)](docs/screenshots/activity-dark.png) |
| Sessions (`/sessions`) | [![Sessions in light theme](docs/screenshots/sessions-light.png)](docs/screenshots/sessions-light.png) | [![Sessions in dark theme](docs/screenshots/sessions-dark.png)](docs/screenshots/sessions-dark.png) |
| Session replay (`/sessions/ses_0000`) | [![Session replay in light theme](docs/screenshots/session-replay-light.png)](docs/screenshots/session-replay-light.png) | [![Session replay in dark theme](docs/screenshots/session-replay-dark.png)](docs/screenshots/session-replay-dark.png) |
| Projects (`/projects`) | [![Projects in light theme](docs/screenshots/projects-light.png)](docs/screenshots/projects-light.png) | [![Projects in dark theme](docs/screenshots/projects-dark.png)](docs/screenshots/projects-dark.png) |
| Project detail (`/projects/proj_infra`) | [![Project detail in light theme](docs/screenshots/project-detail-light.png)](docs/screenshots/project-detail-light.png) | [![Project detail in dark theme](docs/screenshots/project-detail-dark.png)](docs/screenshots/project-detail-dark.png) |
| Tools (`/tools`) | [![Tools in light theme](docs/screenshots/tools-light.png)](docs/screenshots/tools-light.png) | [![Tools in dark theme](docs/screenshots/tools-dark.png)](docs/screenshots/tools-dark.png) |
| Todos (`/todos`) | [![Todos in light theme](docs/screenshots/todos-light.png)](docs/screenshots/todos-light.png) | [![Todos in dark theme](docs/screenshots/todos-dark.png)](docs/screenshots/todos-dark.png) |
| Costs (`/costs`) | [![Costs in light theme](docs/screenshots/costs-light.png)](docs/screenshots/costs-light.png) | [![Costs in dark theme](docs/screenshots/costs-dark.png)](docs/screenshots/costs-dark.png) |
| Agents (`/agents`) | [![Agents in light theme](docs/screenshots/agents-light.png)](docs/screenshots/agents-light.png) | [![Agents in dark theme](docs/screenshots/agents-dark.png)](docs/screenshots/agents-dark.png) |
| Subagent tree (`/agents/tree`) | [![Subagent tree in light theme](docs/screenshots/subagent-tree-light.png)](docs/screenshots/subagent-tree-light.png) | [![Subagent tree in dark theme](docs/screenshots/subagent-tree-dark.png)](docs/screenshots/subagent-tree-dark.png) |
| Export (`/export`) | [![Export in light theme](docs/screenshots/export-light.png)](docs/screenshots/export-light.png) | [![Export in dark theme](docs/screenshots/export-dark.png)](docs/screenshots/export-dark.png) |
| Settings (`/settings`) | [![Settings in light theme](docs/screenshots/settings-light.png)](docs/screenshots/settings-light.png) | [![Settings in dark theme](docs/screenshots/settings-dark.png)](docs/screenshots/settings-dark.png) |
| Model pricing (`/settings/pricing`) | [![Model pricing in light theme](docs/screenshots/pricing-light.png)](docs/screenshots/pricing-light.png) | [![Model pricing in dark theme](docs/screenshots/pricing-dark.png)](docs/screenshots/pricing-dark.png) |
| Style guide (`/style-guide`) | [![Style guide in light theme](docs/screenshots/style-guide-light.png)](docs/screenshots/style-guide-light.png) | [![Style guide in dark theme](docs/screenshots/style-guide-dark.png)](docs/screenshots/style-guide-dark.png) |

## Develop

```sh
pnpm install
pnpm fixture
OC_LENS_DB="$PWD/test/fixtures/populated.db" pnpm dev
```

The fixture is synthetic and deterministic. Tests must use fixture databases, never a developer's real opencode history. See [CONTRIBUTING.md](CONTRIBUTING.md) before taking a ticket.

## Security and privacy

- The opencode database connection is opened with SQLite `readOnly: true`.
- SQL access rejects credential-bearing tables before SQLite executes the query.
- Routes do not write to opencode data or files.
- The only mutating route is `PUT /api/pricing`, and it can write only oc-lens's own fixed config path.
- Safe settings are allowlisted and unknown configuration keys are redacted.
- The server listens on loopback; oc-lens has no telemetry or remote service.

The full threat boundary and enforced tests are documented in [SECURITY.md](SECURITY.md).

## Licence and attribution

oc-lens is released under the [MIT License](LICENSE).

Its information architecture and interaction design were inspired by [cc-lens v0.4.1](https://github.com/Arindam200/cc-lens), which is also MIT-licensed. oc-lens is independently implemented against opencode's data model; cc-lens code and its Claude Code data-access layer are not copied.
