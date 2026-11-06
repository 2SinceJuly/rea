import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { cliTest } from "../../support/cli/cliFixture.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { cargoLockfileSchema } from "../../../src/domain/cargoLockfile/cargoLockfile.js";

const fixture = new URL(
  "../../fixtures/cargo/workspace-member/Cargo.lock",
  import.meta.url,
);

cliTest(
  "inventories Cargo lockfile records through MCP without fetching or rebuilding",
  async () => {
    const root = await createTestTempDirectory("rea-public-cargo-lockfile-");
    const path = join(root, "Cargo.lock");
    const text = await readFile(fixture, "utf8");
    await writeFile(path, text);
    const { call } = await connectLocalToolsMcp({
      REA_MCP_TOOL_FAMILIES: "application,session",
    });

    const response = await call("inspect_cargo_lockfile", { path });
    expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
    const evidence = parseEvidence(response.structuredContent);
    const report = cargoLockfileSchema.parse(evidence.normalized_result);

    expect(report.artifact).toMatchObject({ path, bytes: text.length });
    expect(report.lock_version).toBe(4);

    const byName = new Map(
      report.packages.map((pinned) => [pinned.name, pinned]),
    );
    expect(byName.get("anyhow")).toMatchObject({
      source: "registry",
      checksum:
        "b3d1d046238990b9cf5bcde22a3fb3584ee5cf65fb2765f454ed428c7a0063da",
    });
    expect(byName.get("local-helper")).toMatchObject({
      source: "local",
      source_detail: null,
    });
    expect(byName.get("pinned-tool")).toMatchObject({
      source: "git",
      source_detail:
        "https://example.invalid/pinned-tool?rev=abc123#abc1230123456789",
    });
    expect(byName.get("rea-fixture-app")).toMatchObject({
      source: "local",
      dependencies: ["anyhow", "local-helper", "pinned-tool", "serde"],
    });

    expect(report.summary).toMatchObject({
      packages: 6,
      registry_packages: 3,
      git_packages: 1,
      path_packages: 2,
      checksummed_packages: 3,
      dependency_edges: 5,
      metadata_entries: 1,
      diagnostics: 0,
    });
    expect(report.source_coverage).toMatchObject({
      status: "complete-within-scope",
      manifests: "not-read",
      registry_access: "not-attempted",
      build_scripts: "not-executed",
    });
  },
);

cliTest(
  "reports an unsupported Cargo lockfile version as a typed input failure",
  async () => {
    const root = await createTestTempDirectory("rea-unsupported-cargo-lock-");
    const path = join(root, "Cargo.lock");
    await writeFile(path, "version = 9\n");
    const { call } = await connectLocalToolsMcp({
      REA_MCP_TOOL_FAMILIES: "application",
    });
    const response = await call("inspect_cargo_lockfile", { path });
    const failure = parseMcpToolError(response);
    expect(failure.error).toMatchObject({
      code: "invalid_request",
      category: "invalid_input",
      retryable: false,
      details: {
        issues: [{ path: ["path"], reason: "invalid_format" }],
      },
    });
  },
);
