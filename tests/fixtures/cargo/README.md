# Cargo manifest fixtures

`workspace-member.toml` is a hand-written manifest shaped after the Cargo book's
workspace-inheritance and target-specific dependency examples. It carries no
third-party content and exists only to exercise `inspect_cargo_manifest`
offline.

The fixture deliberately declares a Git dependency, a path dependency, a
renamed dependency, an optional dependency, a target-specific table and a
workspace-inherited declaration so the acceptance test can assert that each
stays distinct instead of being flattened into a resolved package.

`workspace-member/Cargo.lock` is a hand-written lockfile shaped after Cargo's
generated format. It pairs with the manifest above and exercises
`inspect_cargo_lockfile`: registry packages with checksums, a Git package with
fragment parameters, a path package with no source and an opaque
`[metadata]` entry. It carries no third-party content.
