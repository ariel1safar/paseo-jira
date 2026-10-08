# Jira Tickets

Jira Tickets opens tickets from the Paseo workspace header or the `/jira` command. It checks the Git branch, then the workspace title, then the workspace name, using the first source with matching configured ticket prefixes. One ticket appears as a header action; several appear in a menu. With no match, the header action is hidden.

In Jira Tickets settings, choose a Paseo project and add prefix-to-URL mappings. For example, map `IC` to `https://jira.example.com/browse/{ticket}`. Prefixes are literal and case-insensitive. URLs must use HTTPS with `{ticket}` in the path or query and cannot contain credentials. Duplicate prefixes within a project are rejected. Settings start empty and apply to all worktrees of the selected project, with no fallback to another project's configuration.

Use `/jira IC-123` to open an exact ticket, or `/jira` to open the detected ticket. Multiple detected tickets require a choice from the header menu or an explicit key. Keys are normalized to uppercase and keep leading zeros. Compact layouts use Paseo's native header and menu presentation.

Requires Paseo 0.11.1 or later on both the daemon and client. The plugin reads Paseo project and workspace descriptors, including the branch, title and name. It stores mappings on the selected host per plugin installation; connected clients share those settings. It does not inspect chat or request Jira data. Links open on the client device, and the browser contacts the configured destination using its normal Jira sign-in session. The plugin needs no Jira API credentials. Removing the plugin installation deletes its settings.
