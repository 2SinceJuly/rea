import type { AnalysisError } from "../analysisErrorBase.js";
import {
  AnalysisInputError,
  AnalysisResourceConstraintError,
} from "../analysisErrorCore.js";
import { digestCanonicalValue } from "../canonicalDigest.js";
import { parseRecordedTransportUrl } from "../recordedTransportUrl.js";
import { err, ok, type Result } from "../result.js";
import {
  CARGO_LOCKFILE_FACT_BYTES,
  CARGO_LOCKFILE_OPERATION,
  type CargoLockedPackage,
  type CargoLockfile,
  type CargoLockfileArtifact,
} from "./cargoLockfile.js";

type DiagnosticCode = CargoLockfile["diagnostics"][number]["code"];

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const pointerPart = (value: string): string =>
  value.replaceAll("~", "~0").replaceAll("/", "~1");
const identity = (prefix: string, facts: unknown) =>
  `${prefix}_${digestCanonicalValue(facts)}`;
const stringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
    ? (value as string[])
    : undefined;

/** One retained string, charged at its expanded UTF-16 length before it is kept. */
const expandedBytes = (value: string): number => value.length * 2;

/** Strip transport userinfo so recorded evidence never carries credentials. */
const credentialFree = (value: string): string => {
  const { credentials } = parseRecordedTransportUrl(value);
  if (credentials === "ambiguous") {
    const parsed = URL.parse(value);
    if (parsed === null) return value;
    parsed.username = "";
    parsed.password = "";
    return parsed.href;
  }
  return credentials === null
    ? value
    : `${value.slice(0, credentials.start)}${value.slice(credentials.end)}`;
};

/** The lockfile formats Cargo has written; v4 is the current one. */
const SUPPORTED_LOCK_VERSIONS = new Set([1, 2, 3, 4]);

const lockVersion = (
  value: unknown,
): "absent" | "unsupported" | { readonly version: number } => {
  // The original lockfile format has no `version` key at all.
  if (value === undefined) return "absent";
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    SUPPORTED_LOCK_VERSIONS.has(value)
    ? { version: value }
    : "unsupported";
};

/**
 * Split a lockfile `source` string into the kind Cargo assigned and the exact
 * detail it wrote. Git sources add fragment parameters after the URL; the URL is
 * kept with its query so the fragment never moves into the credentials span.
 */
const classifySource = (
  source: string | undefined,
  path: string | undefined,
):
  | {
      readonly source: CargoLockedPackage["source"];
      readonly sourceDetail: string | null;
    }
  | undefined => {
  if (source === undefined) {
    // A path dependency has no `source`; Cargo records its location in the
    // package's own entry only for the root, so an absent source plus no path
    // is the local/vendored case rather than an unknown.
    return typeof path === "string"
      ? { source: "path", sourceDetail: credentialFree(path) }
      : { source: "local", sourceDetail: null };
  }
  if (source.startsWith("registry+")) {
    const url = source.slice("registry+".length);
    return url.length === 0
      ? undefined
      : { source: "registry", sourceDetail: credentialFree(url) };
  }
  if (source.startsWith("git+")) {
    const url = source.slice("git+".length);
    return url.length === 0
      ? undefined
      : { source: "git", sourceDetail: credentialFree(url) };
  }
  if (source.startsWith("path+")) {
    const url = source.slice("path+".length);
    return url.length === 0
      ? undefined
      : { source: "path", sourceDetail: credentialFree(url) };
  }
  return undefined;
};

/** Own package inventory and account for retained facts before allocation. */
class CargoLockInventory {
  readonly packages: CargoLockedPackage[] = [];
  readonly metadata: CargoLockfile["metadata"] = [];
  readonly diagnostics: CargoLockfile["diagnostics"] = [];
  #retainedBytes = 0;

  constructor(readonly artifact: CargoLockfileArtifact) {}

  /** Charge retained values by their expanded representation, not by their count. */
  retain(
    ...values: readonly (string | readonly string[])[]
  ): Result<void, AnalysisError> {
    let bytes = 0;
    for (const value of values)
      bytes +=
        typeof value === "string"
          ? expandedBytes(value)
          : value.reduce((total, item) => total + expandedBytes(item), 0);
    this.#retainedBytes += bytes;
    return this.#retainedBytes <= CARGO_LOCKFILE_FACT_BYTES
      ? ok(undefined)
      : err(
          new AnalysisResourceConstraintError(
            CARGO_LOCKFILE_OPERATION,
            "memory",
            "Cargo lockfile records exceed the retained-facts representation allowance.",
            { representation_bytes: CARGO_LOCKFILE_FACT_BYTES },
            {
              retryable: false,
              remediationAction:
                "Select a smaller complete lockfile; reply paging does not increase the parser's retained-facts allowance.",
            },
          ),
        );
  }

  diagnostic(
    code: DiagnosticCode,
    pointer: string,
    message: string,
  ): Result<void, AnalysisError> {
    const admitted = this.retain(message, pointer);
    if (!admitted.ok) return admitted;
    this.diagnostics.push({
      diagnostic_id: identity("cargo_lockfile_diagnostic", [
        this.artifact.sha256,
        pointer,
        code,
      ]),
      ledger_pointer: pointer,
      code,
      message,
    });
    return ok(undefined);
  }
}

/** Field-level problems that would otherwise become plausible package records. */
const packageProblems = (
  record: Record<string, unknown>,
): readonly string[] => {
  const problems: string[] = [];
  if (typeof record.name !== "string" || record.name.length === 0)
    problems.push("name is absent or is not a string");
  if (typeof record.version !== "string" || record.version.length === 0)
    problems.push("version is absent or is not a string");
  if (record.source !== undefined && typeof record.source !== "string")
    problems.push("source is not a string");
  if (record.checksum !== undefined && typeof record.checksum !== "string")
    problems.push("checksum is not a string");
  if (record.replace !== undefined && typeof record.replace !== "string")
    problems.push("replace is not a string");
  if (
    record.dependencies !== undefined &&
    stringArray(record.dependencies) === undefined
  )
    problems.push("dependencies is not an array of strings");
  return problems;
};

/**
 * Inventory resolved package records in one already-parsed lockfile; nothing is
 * fetched, resolved or executed.
 */
// The body walks the lockfile's independent top-level sections (the version
// tuple, the package ledger, and opaque metadata); the package walk delegates
// its own record semantics, so the length is structural.
// eslint-disable-next-line max-lines-per-function, complexity
export const parseCargoLockfile = (
  document: unknown,
  artifact: CargoLockfileArtifact,
): Result<CargoLockfile, AnalysisError> => {
  const table = record(document);
  const fail = (message: string): Result<CargoLockfile, AnalysisError> =>
    err(
      new AnalysisInputError(CARGO_LOCKFILE_OPERATION, undefined, [
        { path: ["path"], reason: "invalid_format", message },
      ]),
    );
  if (table === undefined)
    return fail("Expected a TOML document at the root of the lockfile.");

  const recordedVersion = lockVersion(table.version);
  if (recordedVersion === "unsupported")
    return fail(
      `Lockfile version ${String(table.version)} is not one this parser reads (1-4).`,
    );

  const packageRecords = table.package;
  if (packageRecords !== undefined && !Array.isArray(packageRecords))
    return fail("`package` is present but is not an array of tables.");

  const inventory = new CargoLockInventory(artifact);
  if (packageRecords === undefined) {
    const recorded = inventory.diagnostic(
      "invalid-package-record",
      "/package",
      "Lockfile declares no [[package]] record.",
    );
    if (!recorded.ok) return recorded;
  }

  const seen = new Map<string, string>();
  for (const [index, entry] of (packageRecords ?? []).entries()) {
    const pointer = `/package/${index}`;
    const packageRecord = record(entry);
    if (packageRecord === undefined) {
      const recorded = inventory.diagnostic(
        "invalid-package-record",
        pointer,
        `Package record ${index} is not a table.`,
      );
      if (!recorded.ok) return recorded;
      continue;
    }
    const problems = packageProblems(packageRecord);
    if (problems.length > 0) {
      const name = packageRecord.name;
      const recorded = inventory.diagnostic(
        "invalid-package-record",
        pointer,
        `Package record ${index}${
          typeof name === "string" ? ` ("${name}")` : ""
        } declares ${problems.join("; ")}.`,
      );
      if (!recorded.ok) return recorded;
      continue;
    }
    const name = packageRecord.name as string;
    const version = packageRecord.version as string;
    const sourceText =
      typeof packageRecord.source === "string"
        ? packageRecord.source
        : undefined;
    const pathText =
      typeof packageRecord.path === "string" ? packageRecord.path : undefined;
    const classified = classifySource(sourceText, pathText);
    if (classified === undefined) {
      const recorded = inventory.diagnostic(
        "invalid-package-record",
        pointer,
        `Package "${name} ${version}" has a source this parser cannot classify.`,
      );
      if (!recorded.ok) return recorded;
      continue;
    }
    // Cargo permits one record per (name, version, source); a repeat means the
    // lockfile is not the one Cargo writes, so it stays visible as a diagnostic.
    const packageIdentity = `${name} ${version} ${classified.sourceDetail ?? ""}`;
    const previous = seen.get(packageIdentity);
    if (previous !== undefined) {
      const recorded = inventory.diagnostic(
        "duplicate-package-identity",
        pointer,
        `Package "${name} ${version}" from the same source repeats the record at ${previous}.`,
      );
      if (!recorded.ok) return recorded;
    } else {
      seen.set(packageIdentity, pointer);
    }
    const dependencies = stringArray(packageRecord.dependencies) ?? [];
    const checksum =
      typeof packageRecord.checksum === "string"
        ? packageRecord.checksum
        : null;
    const replaces =
      typeof packageRecord.replace === "string" ? packageRecord.replace : null;
    const admitted = inventory.retain(
      name,
      version,
      classified.sourceDetail ?? "",
      checksum ?? "",
      replaces ?? "",
      dependencies,
      pointer,
    );
    if (!admitted.ok) return admitted;
    inventory.packages.push({
      package_id: identity("cargo_locked_package", [
        artifact.sha256,
        name,
        version,
        classified.sourceDetail,
      ]),
      name,
      version,
      source: classified.source,
      source_detail: classified.sourceDetail,
      checksum,
      replaces,
      dependencies,
      ledger_pointer: pointer,
    });
  }

  const metadataTable = record(table.metadata);
  if (table.metadata !== undefined && metadataTable === undefined) {
    const recorded = inventory.diagnostic(
      "invalid-metadata",
      "/metadata",
      "[metadata] is present but is not a table.",
    );
    if (!recorded.ok) return recorded;
  }
  if (metadataTable !== undefined)
    for (const [key, value] of Object.entries(metadataTable)) {
      const encoded = JSON.stringify(value);
      const admitted = inventory.retain(key, encoded);
      if (!admitted.ok) return admitted;
      inventory.metadata.push({
        key,
        value: encoded,
        ledger_pointer: `/metadata/${pointerPart(key)}`,
      });
    }

  // Each dependency entry names a package by "name", "name version", or
  // "name version (source)". Resolve it against the records read above without
  // guessing: an unknown or ambiguous reference stays a diagnostic.
  const byName = new Map<string, CargoLockedPackage[]>();
  for (const pinned of inventory.packages) {
    const existing = byName.get(pinned.name);
    if (existing === undefined) byName.set(pinned.name, [pinned]);
    else existing.push(pinned);
  }
  const recordsNamed = (dependency: string): CargoLockedPackage[] => {
    const name = dependency.split(" ")[0] ?? "";
    return byName.get(name) ?? [];
  };
  let edges = 0;
  for (const pinned of inventory.packages)
    for (const dependency of pinned.dependencies) {
      const candidates = recordsNamed(dependency);
      if (candidates.length === 0) {
        const recorded = inventory.diagnostic(
          "unresolved-dependency-reference",
          pinned.ledger_pointer,
          `Package "${pinned.name} ${pinned.version}" depends on "${dependency}", which has no record in this lockfile.`,
        );
        if (!recorded.ok) return recorded;
        continue;
      }
      // A bare name is unambiguous only when the lockfile holds one record for
      // it; Cargo writes the version tuple when several exist.
      if (candidates.length > 1 && !dependency.includes(" ")) {
        const recorded = inventory.diagnostic(
          "ambiguous-dependency-reference",
          pinned.ledger_pointer,
          `Package "${pinned.name} ${pinned.version}" depends on "${dependency}", which matches ${candidates.length} records; Cargo writes the version tuple in that case.`,
        );
        if (!recorded.ok) return recorded;
        continue;
      }
      edges += 1;
    }

  const count = (predicate: (pinned: CargoLockedPackage) => boolean) =>
    inventory.packages.filter(predicate).length;

  return ok({
    lockfile_id: `cargo_lockfile_${artifact.sha256}`,
    format: "cargo-lock",
    lock_version: recordedVersion === "absent" ? null : recordedVersion.version,
    artifact,
    packages: inventory.packages,
    metadata: inventory.metadata,
    diagnostics: inventory.diagnostics,
    summary: {
      packages: inventory.packages.length,
      registry_packages: count((pinned) => pinned.source === "registry"),
      git_packages: count((pinned) => pinned.source === "git"),
      path_packages: count(
        (pinned) => pinned.source === "path" || pinned.source === "local",
      ),
      checksummed_packages: count((pinned) => pinned.checksum !== null),
      dependency_edges: edges,
      replaced_packages: count((pinned) => pinned.replaces !== null),
      metadata_entries: inventory.metadata.length,
      diagnostics: inventory.diagnostics.length,
    },
    source_coverage: {
      scope: "resolved-lockfile-records",
      status:
        inventory.diagnostics.length === 0
          ? "complete-within-scope"
          : "partial",
      manifests: "not-read",
      resolution: "not-attempted",
      registry_access: "not-attempted",
      build_scripts: "not-executed",
    },
    limitations: [
      "Only the supplied Cargo.lock is read; manifests, workspace members and vendor outputs are not opened.",
      "Recorded packages are Cargo's resolved output; this parser neither re-resolves nor verifies a checksum against a registry.",
      "A path or vendored package is identified by the lockfile alone, so its on-disk contents and feature selection are unknown.",
      "`[metadata]` values are opaque to Cargo and are retained as encoded JSON without interpretation.",
    ],
  });
};
