# Temporary MCP connections for occasional REA use

Use this guide when you want REA's tools for one reverse-engineering task, then
want the client to go back to how it was. It covers when MCP is worth the extra
setup, what the supported routes actually isolate, and how to verify and undo
the task's changes without touching other sessions.

REA's docs describe setup and the MCP runtime contracts; this page is the
lifecycle around them. The [installation guide](../installation.md)
owns the review-and-approve setup steps, and [MCP runtime contracts](../reference/mcp-contracts.md)
owns tool results, transports and cancellation.

## Choose MCP or the CLI

The CLI and MCP server run the same analysis, so pick by what the session has to
keep, not by which produces better results.

Choose MCP when the task needs one of these across calls:

- **Retained Evidence.** `analyze_function` without `detail: "complete"`
  retains the complete dossier in the session and returns a summary view;
  later calls page it through `inspect_analysis_view` and
  `{"kind": "retained-evidence", "evidence_id": "<id>"}` sources. The CLI
  prints one result and exits.
- **A live provider session.** A cold provider, such as a first Ghidra query,
  has a startup deadline the MCP server reports and recovers from while its
  providers stay loaded between calls.
- **Several tools as one conversation.** Comparing artifacts, matching native
  functions and building call paths pass Evidence between tools in one
  session.

Choose the CLI when each step can run to completion on its own. It needs no
client registration or restart, and `--json` returns the same canonical
Evidence record that MCP returns. A one-shot `inspect-artifact` or
`analyze-javascript-application` does not benefit from a long-lived server.

## What a temporary connection does and does not isolate

A temporary connection is opt-in scoping, not a sandbox. Both supported routes
below decide which sessions discover REA's MCP server and skill. They leave
REA's shell commands, filesystem access and network access available to an agent
under the same OS account. For clean-room separation, use an implementation
environment with filesystem and network restrictions that prevent reading or
fetching REA, the target and analysis output, including through shared
installations and package registries. A separate account or container must
enforce those restrictions. See [Limit REA to one project or agent profile](../installation.md#limit-rea-to-one-project-or-agent-profile).

No route attaches REA to a conversation that is already running. Client
discovery happens when the session or server starts, so either start a session
with the scoped configuration or reconnect the client. Dynamic attachment
during a live conversation is up to each client and is not an REA contract.

## Route 1: a scoped Claude Code profile

A separate `CLAUDE_CONFIG_DIR` keeps the registration, skill and session
history in their own directory. Setup follows the variable for both the
registration and the skill:

```bash
CLAUDE_CONFIG_DIR=~/.claude-rea npx rea-agents setup --client claude_code
CLAUDE_CONFIG_DIR=~/.claude-rea claude
```

Sessions started without the variable keep the default profile's registration,
skill and history, so an unrelated session is unaffected. Keep the same prefix
on every profile command, because bare commands inspect or recreate
default-profile state (see [the profile section](../installation.md#limit-rea-to-one-project-or-agent-profile)
for the matching doctor, dry-run and removal commands).

Undo it in this order:

1. Quit the profile's sessions.
2. Remove the registration and the REA-managed skill from that profile only:
   `CLAUDE_CONFIG_DIR=~/.claude-rea claude mcp remove --scope user rea`, then
   remove `~/.claude-rea/skills/reverse-engineer-anything`. Keep other skills in
   the profile intact.
3. Delete `~/.claude-rea` when its session history is no longer needed.

`rea uninstall` is broader than this route: it applies to other clients too.

## Route 2: a local-scope project registration

Claude Code's local scope stores a registration under one project directory in
the default profile, so other projects do not load it. This route installs no
skill and leaves the user-level entry alone.

Install REA without client setup (the curl installer's `--no-setup`), then
register it from the project directory with `CLAUDE_CONFIG_DIR` unset for the
whole lifecycle:

```bash
claude mcp add --scope local rea -- "/absolute/path/to/node" "/absolute/path/to/rea/scripts/rea.mjs" mcp
```

Prefer local scope over `--scope project`, which writes `.mcp.json` into the
repository where it can be committed or copied.

Undo it with `claude mcp remove --scope local rea` from the same directory. Two
behaviors matter for cleanup: `rea doctor` and `rea uninstall` read only the
user-level entry, so neither reports or removes a local-scope registration, and
`rea update` does not refresh it. Record a caller-selected override such as
`REA_MCP_INPUT_SCHEMA_PROFILE`, `REA_MCP_MAX_RESPONSE_BYTES` or
`REA_MCP_TOOL_FAMILIES` before removing the entry; re-adding it does not restore
those values. The [installation guide](../installation.md#limit-rea-to-one-project-or-agent-profile)
covers the full replacement sequence.

## Restart and configuration restoration

Setup is additive and preserves unrelated entries, comments and settings: it
backs up changed configuration, stages edits in a private directory and
verifies the result. Both routes therefore restore the surrounding
configuration without a separate revert step:

- The profile route changes only `$CLAUDE_CONFIG_DIR`, so removing that
  directory restores the default profile untouched.
- The local-scope route adds one entry to the default profile. Removing it with
  `claude mcp remove` leaves the rest of `~/.claude.json` as it was.

Setup's own recovery applies when a write is interrupted rather than when you
undo a successful registration. If an edit made a backup, a failed uninstall
update or restore, or a failed setup readback or rollback, the message names the
backup path holding the bytes from just before the change; see
[installation and recovery](../installation.md). A detected
conflict names its recovery backup instead of overwriting a file that changed
since setup read it.

Cancellation and failure look the same here as a successful undo: the client
owns launching the stdio process, and a killed or disconnected client ends it.
An interrupted `setup` that exits before writing a registration leaves the
previous configuration in place; rerun the dry-run to confirm.

## Verify that only the task's server exited

The stdio process belongs to the client that launched it. Confirm that it is
gone rather than assuming it:

- `rea mcp doctor --json` checks production MCP startup and reports child logs.
  Run it with the same environment the scoped session used, so it inspects that
  registration rather than the default profile.
- An HTTP listener started with `rea mcp --http` is the exception to
  client ownership: it runs until SIGINT or SIGTERM and does not stop when its
  client disconnects. Stop it explicitly, and confirm nothing else in that
  session shares the port.

On Linux, REA owns supervised children through a procps-compatible `ps` on its
`PATH`. Ownership checks cover the providers that launch children (Ghidra,
JADX, Apktool, firmware tools and static JavaScript/Electron analysis); a
missing `ps` refuses the launch before a child starts. Where an owned process
survives a close, REA reports it as incomplete cleanup.

Report incomplete cleanup with three facts: the registration or entry you
removed, the process or child that survived (its command and owner token, not
just its name), and the backup or recovery path named by the command. Removing
a registration does not remove analysis output or cached providers; report
those path-by-path if they matter to the task.

## Keep the connection opt-in

Do not convert this workflow into a persistent service. REA does not start a
background MCP server, install a native analysis engine, or modify another
client's configuration on its own. Each route is a deliberate, reviewed
registration while a task is active, and its removal returns the client to the
configuration it had before.
