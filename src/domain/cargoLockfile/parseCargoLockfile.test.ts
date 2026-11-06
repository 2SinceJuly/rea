import { parse as parseToml } from "smol-toml";
import { describe, expect, it } from "vitest";
import type { CargoLockfile } from "./cargoLockfile.js";
import { parseCargoLockfile } from "./parseCargoLockfile.js";

const artifact: CargoLockfile["artifact"] = {
  path: "/fixtures/Cargo.lock",
  sha256: "a".repeat(64),
  bytes: 512,
};

const parse = (toml: string) => parseCargoLockfile(parseToml(toml), artifact);

const required = <T>(result: { ok: boolean; value?: T }): T => {
  expect(result.ok).toBe(true);
  if (result.value === undefined) throw new Error("Expected a parsed lockfile");
  return result.value;
};

const sample = `
version = 4

[[package]]
name = "demo"
version = "0.1.0"
dependencies = ["serde", "anyhow 1.0.86"]

[[package]]
name = "serde"
version = "1.0.203"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "1111111111111111111111111111111111111111111111111111111111111111"

[[package]]
name = "anyhow"
version = "1.0.86"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "2222222222222222222222222222222222222222222222222222222222222222"
`;

describe("parseCargoLockfile packages", () => {
  it("inventories resolved packages without resolving or fetching", () => {
    const value = required(parse(sample));
    expect(value.format).toBe("cargo-lock");
    expect(value.lock_version).toBe(4);
    expect(value.artifact).toEqual(artifact);
    expect(
      value.packages.map((pinned) => [
        pinned.name,
        pinned.version,
        pinned.source,
      ]),
    ).toEqual([
      ["demo", "0.1.0", "local"],
      ["serde", "1.0.203", "registry"],
      ["anyhow", "1.0.86", "registry"],
    ]);
    expect(value.diagnostics).toEqual([]);
    expect(value.summary).toMatchObject({
      packages: 3,
      registry_packages: 2,
      checksummed_packages: 2,
      dependency_edges: 2,
    });
    expect(value.source_coverage).toMatchObject({
      scope: "resolved-lockfile-records",
      status: "complete-within-scope",
    });
  });

  it("keeps a git source with its fragment parameters and strips credentials", () => {
    const value = required(
      parse(`
[[package]]
name = "tool"
version = "0.2.0"
source = "git+https://user:token@example.test/tool?branch=main#0123456789abcdef"
`),
    );
    expect(value.packages[0]).toMatchObject({
      source: "git",
      source_detail: "https://example.test/tool?branch=main#0123456789abcdef",
    });
    expect(value.diagnostics).toEqual([]);
  });

  it("marks a path source and reads a replaced package", () => {
    const value = required(
      parse(`
[[package]]
name = "local"
version = "0.1.0"
source = "path+file:///workspace/local"

[[package]]
name = "patched"
version = "1.0.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
replace = "patched 0.9.0"
`),
    );
    expect(value.packages[0]).toMatchObject({ source: "path" });
    expect(value.packages[1]).toMatchObject({
      replaces: "patched 0.9.0",
    });
    expect(value.summary).toMatchObject({
      path_packages: 1,
      replaced_packages: 1,
    });
  });

  it("accepts a legacy lockfile without a version field", () => {
    const value = required(
      parse(`
[[package]]
name = "demo"
version = "0.1.0"
`),
    );
    expect(value.lock_version).toBeNull();
    expect(value.diagnostics).toEqual([]);
  });

  it("rejects a lockfile version it does not read", () => {
    const result = parse(`version = 9\n`);
    expect(result.ok).toBe(false);
  });
});

describe("parseCargoLockfile diagnostics", () => {
  it("reports a malformed package record instead of a plausible fact", () => {
    const value = required(
      parse(`
[[package]]
name = "demo"
version = 7
`),
    );
    expect(value.packages).toEqual([]);
    expect(value.diagnostics[0]).toMatchObject({
      code: "invalid-package-record",
      ledger_pointer: "/package/0",
    });
  });

  it("reports a dependency with no record in the lockfile", () => {
    const value = required(
      parse(`
[[package]]
name = "demo"
version = "0.1.0"
dependencies = ["absent"]
`),
    );
    expect(value.summary.dependency_edges).toBe(0);
    expect(value.diagnostics[0]).toMatchObject({
      code: "unresolved-dependency-reference",
    });
  });

  it("reports an ambiguous bare-name dependency", () => {
    const value = required(
      parse(`
[[package]]
name = "demo"
version = "0.1.0"
dependencies = ["dup"]

[[package]]
name = "dup"
version = "1.0.0"

[[package]]
name = "dup"
version = "2.0.0"
`),
    );
    expect(value.diagnostics[0]).toMatchObject({
      code: "ambiguous-dependency-reference",
    });
  });

  it("reports a duplicated package identity", () => {
    const value = required(
      parse(`
[[package]]
name = "demo"
version = "0.1.0"

[[package]]
name = "demo"
version = "0.1.0"
`),
    );
    expect(value.diagnostics[0]).toMatchObject({
      code: "duplicate-package-identity",
    });
    expect(value.packages).toHaveLength(2);
  });

  it("retains opaque metadata as encoded JSON", () => {
    const value = required(
      parse(`
[[package]]
name = "demo"
version = "0.1.0"

[metadata]
"checksum demo 0.1.0 (registry+https://example.test)" = "abc"
`),
    );
    expect(value.metadata[0]).toMatchObject({
      key: "checksum demo 0.1.0 (registry+https://example.test)",
      value: '"abc"',
    });
  });

  it("marks coverage partial whenever a diagnostic was recorded", () => {
    const value = required(
      parse(`
[[package]]
name = "demo"
version = "0.1.0"
dependencies = ["absent"]
`),
    );
    expect(value.source_coverage.status).toBe("partial");
  });

  it("rejects a document that is not a table", () => {
    expect(parseCargoLockfile("not a table", artifact).ok).toBe(false);
  });

  it("rejects a package section that is not an array of tables", () => {
    expect(parse(`package = "demo"\n`).ok).toBe(false);
  });

  it("charges retained dependency contents against the fact allowance", () => {
    // 2 bytes per retained character: 200 entries of 100k characters exceeds 32 MiB.
    const dependencies = Array.from({ length: 200 }, () => "x".repeat(100_000));
    const result = parse(`
[[package]]
name = "demo"
version = "0.1.0"
dependencies = [${dependencies.map((item) => `"${item}"`).join(", ")}]
`);
    expect(result.ok).toBe(false);
  });
});
