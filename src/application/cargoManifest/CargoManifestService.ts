import type { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  CARGO_MANIFEST_OPERATION as operation,
  CARGO_MANIFEST_PROVIDER,
  type CargoManifest,
  type CargoManifestArtifact,
} from "../../domain/cargoManifest/cargoManifest.js";
import { inspectCargoManifestInputSchema } from "../../domain/cargoManifest/cargoManifestQuery.js";
import { parseCargoManifest } from "../../domain/cargoManifest/parseCargoManifest.js";
import type { Result } from "../../domain/result.js";
import {
  inspectCargoArtifact,
  type CargoInspection,
} from "../cargoToml/CargoInspection.js";

export type CargoManifestInspection = CargoInspection<
  CargoManifest,
  CargoManifestArtifact
>;

/** Read one verified Cargo.toml and inventory its declarations; no Cargo runs. */
export const inspectCargoManifestEvidence = (
  rawInput: unknown,
  resources: ArtifactResourceScope,
  options: { readonly signal?: AbortSignal } = {},
): Promise<Result<CargoManifestInspection, AnalysisError>> =>
  inspectCargoArtifact(
    {
      operation,
      provider: CARGO_MANIFEST_PROVIDER,
      querySchema: inspectCargoManifestInputSchema,
      predicateType: "rea.cargo-manifest-inventory",
      artifact: (path, sha256, bytes) => ({ path, sha256, bytes }),
      parse: parseCargoManifest,
      limitationsOf: (report) => report.limitations,
    },
    rawInput,
    resources,
    options,
  );
