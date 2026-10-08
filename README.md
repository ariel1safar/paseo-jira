# Jira Tickets

Open Jira tickets from a Paseo workspace header or `/jira`. Each Paseo project has its own prefix-to-URL mappings, shared by all its worktrees.

Requires Paseo **0.11.1 or later** on the daemon and client. No Jira account configuration or API token is required by the plugin; your browser handles Jira sign-in normally.

## Setup

Install the tagged Git source:

```sh
paseo plugin install git:ariel1safar/paseo-jira --ref v0.1.0
```

Enable plugins under **Settings → Plugins**, enable **Jira Tickets**, and open its settings screen.

1. Choose a Paseo project.
2. Add one or more mappings, such as prefix `IC` and URL template `https://jira.example.com/browse/{ticket}`.
3. Save the project mappings.

Mappings start empty. They are saved on the selected host, per plugin installation, with project IDs as keys. There is no global or host-wide fallback. Other clients connected to that installation see the same settings. Removing the installation deletes its settings.

Prefixes are literal, case-insensitive strings starting with a letter and containing letters, digits or underscores. Duplicate prefixes within a project are rejected. URL templates must use HTTPS, contain `{ticket}` in the path or query, and have no credentials. The placeholder cannot appear in the authority or fragment. Query templates such as `https://jira.example.com/issues?key={ticket}` also work.

## Usage

The plugin looks for configured `PREFIX-number` keys in this order:

1. Git branch
2. Workspace title
3. Workspace name

It uses the first source with configured matches, removes repetitions, uppercases keys and preserves digits, including leading zeros. Letters, numbers and underscores cannot touch the outside of a key; hyphens and slashes can separate branch prose.

One match shows a header action labeled with the key. Multiple matches show a menu. No match hides the action. Compact layouts use Paseo's icon and menu presentation.

- `/jira IC-123` opens that exact ticket using the current project's mapping.
- `/jira` opens the detected ticket, or explains how to choose when several match.

Links open in the browser on the **client device**, including when the daemon is remote. The plugin does not fetch Jira data, read chat, send tickets to an agent, or handle credentials. Opening a link makes the normal browser request to your configured destination. Workspace descriptors and project settings are cached to preserve browser user activation.

The settings editor keeps its opening revision while you edit. Concurrent saves reject a stale revision rather than overwrite another client's changes. Reload discards your draft and reads saved settings. Changing the selected project also discards unsaved edits.

## Development

Use Node.js 24 or later. Paseo provides all runtime libraries; this package has only development dependencies.

```sh
NODE_TLS_REJECT_UNAUTHORIZED=1 npm ci
npm test
npm run typecheck
npm pack --dry-run
```

For local testing on an isolated daemon, install this workspace's absolute path, then reload after changes:

```sh
paseo --host <isolated-daemon-url> plugin install /absolute/path/to/paseo-jira
paseo --host <isolated-daemon-url> plugin reload paseo-jira
```

`shared/` contains validation and ticket resolution. `client/` owns the settings editor, cached header/slash controller and owned subscription lifecycle. The server entry registers the version 1 host settings document. Tests use Node's built-in runner with deterministic fake transport boundaries and controlled promises, without Jira requests.

Verify changes in desktop and compact layouts, light and dark themes, and across a daemon restart to check settings persistence. Use `npm pack --dry-run` to confirm the package includes the plugin sources and screenshot assets.

MIT license. Repository: [ariel1safar/paseo-jira](https://github.com/ariel1safar/paseo-jira).
