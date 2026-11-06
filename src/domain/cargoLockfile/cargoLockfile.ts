import { z } from "zod";
import { digestSchema, prefixedDigestSchema } from "../digests.js";
import { localPathStringSchema } from "../localPath.js";

/** Resource allowances, not Cargo or TOML format limits. */
export const CARGO_LOCKFILE_MAX_FILE_BYTES = 32 * 1024 * 1024;
export const CARGO_LOCKFILE_FACT_BYTES = 32 * 1024 * 1024;
export const CARGO_LOCKFILE_OPERATION = "inspect_cargo_lockfile" as const;
export const CARGO_LOCKFILE_PROVIDER = {
  id: "rea-cargo-lockfile",
  name: "REA offline Cargo lockfile inventory",
  version: "1",
} as const;

export const cargoLockfileArtifactSchema = z.strictObject({
  path: localPathStringSchema,
  sha256: digestSchema,
  bytes: z.int().nonnegative(),
});
export type CargoLockfileArtifact = z.output<
  typeof cargoLockfileArtifactSchema
>;

/** A lockfile package records what Cargo resolved; it is not a manifest declaration. */
export const cargoLockedPackageSchema = z.strictObject({
  package_id: prefixedDigestSchema("cargo_locked_package"),
  name: z.string(),
  version: z.string(),
  /** `registry`, `git`, `path`, `local` (a path source without a URL) or `unknown`. */
  source: z.enum(["registry", "git", "path", "local", "unknown"]),
  /** The lockfile `source` string, or a reconstructed path for a `local` source. */
  source_detail: z.string().nullable(),
  checksum: z.string().nullable(),
  /** Cargo writes `replace` for a package swapped through a patch entry. */
  replaces: z.string().nullable(),
  dependencies: z.array(z.string()),
  ledger_pointer: z.string(),
});
export type CargoLockedPackage = z.output<typeof cargoLockedPackageSchema>;

export const cargoLockfileDiagnosticSchema = z.strictObject({
  diagnostic_id: prefixedDigestSchema("cargo_lockfile_diagnostic"),
  ledger_pointer: z.string(),
  code: z.enum([
    "invalid-toml",
    "unsupported-lockfile-version",
    "invalid-package-record",
    "duplicate-package-identity",
    "unresolved-dependency-reference",
    "ambiguous-dependency-reference",
    "invalid-metadata",
  ]),
  message: z.string(),
});
export type CargoLockfileDiagnostic = z.output<
  typeof cargoLockfileDiagnosticSchema
>;

export const cargoLockfileSchema = z.strictObject({
  lockfile_id: prefixedDigestSchema("cargo_lockfile"),
  format: z.literal("cargo-lock"),
  /** The `version` field Cargo writes on newer lockfiles; absent on the original format. */
  lock_version: z.int().positive().nullable(),
  artifact: cargoLockfileArtifactSchema,
  packages: z.array(cargoLockedPackageSchema),
  /** Cargo's `[metadata]` table, which is opaque to Cargo itself. */
  metadata: z.array(
    z.strictObject({
      key: z.string(),
      /** A JSON encoding of the metadata value; Cargo does not interpret it. */
      value: z.string(),
      ledger_pointer: z.string(),
    }),
  ),
  diagnostics: z.array(cargoLockfileDiagnosticSchema),
  summary: z.strictObject({
    packages: z.int().nonnegative(),
    registry_packages: z.int().nonnegative(),
    git_packages: z.int().nonnegative(),
    path_packages: z.int().nonnegative(),
    checksummed_packages: z.int().nonnegative(),
    dependency_edges: z.int().nonnegative(),
    replaced_packages: z.int().nonnegative(),
    metadata_entries: z.int().nonnegative(),
    diagnostics: z.int().nonnegative(),
  }),
  source_coverage: z.strictObject({
    scope: z.literal("resolved-lockfile-records"),
    status: z.enum(["complete-within-scope", "partial"]),
    manifests: z.literal("not-read"),
    resolution: z.literal("not-attempted"),
    registry_access: z.literal("not-attempted"),
    build_scripts: z.literal("not-executed"),
  }),
  limitations: z.array(z.string()),
});
export type CargoLockfile = z.output<typeof cargoLockfileSchema>;
