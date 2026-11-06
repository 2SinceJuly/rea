# Offline Cargo manifest inventory

`inspect_cargo_manifest` reads one local `Cargo.toml`. It inventories declared
packages, dependencies, target-specific tables and features; the facts describe
declarations, not resolved, downloaded or compiled dependencies.

This version deliberately stops at a single manifest:

- `Cargo.lock` is not read, so no resolved version, checksum or lockfile source
  identifier appears in the result.
- Workspace member manifests are not opened. `[workspace.dependencies]` entries
  in the supplied manifest are inventoried as declarations, and a member's
  `workspace = true` entry is reported as inherited rather than resolved to the
  workspace requirement.
- Cargo, build scripts, proc macros and dependency code are never executed, and
  no registry or network request is made.
- Target conditions such as `cfg(windows)` are recorded verbatim and are not
  evaluated for the current host.

Anything the manifest does not state is absent rather than inferred: a
dependency with no version, `path`, `git` or `workspace` source is reported as
an `invalid-dependency-declaration` diagnostic instead of a synthesized package.

## Declaration shape

Each dependency keeps the manifest text that produced it:

| fact             | meaning                                                        |
| ---------------- | -------------------------------------------------------------- |
| `dependency_key` | identity that survives later edits to the same declaration     |
| `dependency_id`  | source-scoped identity, including the manifest digest          |
| `name` / `alias` | package name and the manifest key when it was renamed          |
| `source`         | `registry`, `git`, `path`, `workspace` or `unknown`            |
| `source_detail`  | path, Git URL with `rev`/`tag`/`branch`, or alternate registry |
| `declared_by`    | `package` or `workspace`                                       |
| `target`         | the `cfg(...)` or target triple from the containing table      |
| `source_pointer` | JSON Pointer into the parsed manifest                          |

`source_coverage` states what was not examined (`lockfile`, `resolution`,
`workspace_member_manifests`) and its `status` is `partial` whenever a
diagnostic was recorded.

## Select a useful answer

```json
{ "path": "/artifacts/Cargo.toml" }
```

`max_file_bytes` defaults to and is capped at 32 MiB. Retained facts are bounded
by a separate 32 MiB allowance, so a manifest large enough to parse can still be
refused for its representation rather than silently truncated.

The manifest must be UTF-8 TOML; duplicate tables and malformed text are typed
`invalid_format` input failures, not partial inventories.

## Offline Cargo lockfile records

`inspect_cargo_lockfile` reads one local `Cargo.lock`. It inventories the
packages Cargo already resolved and wrote, without a manifest read, a registry
request, a checksum verification or any build. Each record keeps what the
lockfile states:

| fact               | meaning                                                   |
| ------------------ | --------------------------------------------------------- |
| `package_id`       | source-scoped identity, including the lockfile digest     |
| `name` / `version` | the resolved identity Cargo recorded                      |
| `source`           | `registry`, `git`, `path`, `local` or `unknown`           |
| `source_detail`    | the source string with transport credentials removed      |
| `checksum`         | the recorded digest, or `null` when the lockfile has none |
| `replaces`         | Cargo's `replace` field for a patched package             |
| `dependencies`     | the reference text exactly as written                     |
| `ledger_pointer`   | JSON Pointer to the `[[package]]` entry                   |

A package with no `source` is reported as `local`, not as an unknown registry
package. Git fragment parameters such as `?branch=main#<sha>` stay attached to
the recorded URL; only transport userinfo is removed. `[metadata]` is opaque to
Cargo and is retained as encoded JSON rather than interpreted.

Dependency references are resolved only within this file: a reference that names
no record, or a bare name that matches several records, is an
`unresolved-dependency-reference` or `ambiguous-dependency-reference` diagnostic
instead of a guessed edge. `source_coverage` states that `manifests`,
`resolution` and `registry_access` were not attempted, and its `status` is
`partial` whenever a diagnostic was recorded.

The lockfile version must be 1-4, or absent for the original format; any other
version is a typed `invalid_format` input failure rather than a partial
inventory.
