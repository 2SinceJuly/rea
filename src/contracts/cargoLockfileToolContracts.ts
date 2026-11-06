import { cargoLockfileSchema } from "../domain/cargoLockfile/cargoLockfile.js";
import { inspectCargoLockfileInputSchema } from "../domain/cargoLockfile/cargoLockfileQuery.js";
import { evidenceResultOf } from "./toolOutputSchemaPrimitives.js";
import { toolContractMetadata } from "./toolEffects.js";
import type { ToolContract } from "./toolContractTypes.js";

/** Named, provider-free contract for resolved records in one local Cargo lockfile. */
export const CARGO_LOCKFILE_TOOL_CONTRACTS = [
  {
    name: "inspect_cargo_lockfile",
    ...toolContractMetadata("inspect_cargo_lockfile"),
    kind: "application",
    description:
      "Inventory the resolved package records Cargo wrote in one local Cargo.lock offline. Cargo, build scripts, proc macros and dependency code stay untouched; there is no registry or network access and no re-resolution. Registry, Git, path and local packages stay distinct, Git fragment parameters are retained with transport credentials removed, checksums and patch replacements are reported as recorded, and Cargo's opaque [metadata] table is kept as encoded JSON. Dependency references that name no record or several records stay diagnostics instead of guessed edges. Manifests and vendor outputs are not read, so feature selection and declaration reconciliation remain unanalyzed. File and retained-facts allowances are each 32 MiB.",
    inputSchema: inspectCargoLockfileInputSchema,
    outputSchema: evidenceResultOf(cargoLockfileSchema),
    examples: [
      {
        title: "Read a lockfile's resolved packages without fetching them",
        input: { path: "/artifacts/Cargo.lock" },
      },
    ],
  },
] as const satisfies readonly ToolContract[];
