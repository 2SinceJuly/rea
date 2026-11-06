import type { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  CARGO_LOCKFILE_OPERATION as operation,
  CARGO_LOCKFILE_PROVIDER,
  type CargoLockfile,
  type CargoLockfileArtifact,
} from "../../domain/cargoLockfile/cargoLockfile.js";
import { inspectCargoLockfileInputSchema } from "../../domain/cargoLockfile/cargoLockfileQuery.js";
import { parseCargoLockfile } from "../../domain/cargoLockfile/parseCargoLockfile.js";
import type { Result } from "../../domain/result.js";
import {
  inspectCargoArtifact,
  type CargoInspection,
} from "../cargoToml/CargoInspection.js";

export type CargoLockfileInspection = CargoInspection<
  CargoLockfile,
  CargoLockfileArtifact
>;

/** Read one verified Cargo.lock and inventory its resolved records; no Cargo runs. */
export const inspectCargoLockfileEvidence = (
  rawInput: unknown,
  resources: ArtifactResourceScope,
  options: { readonly signal?: AbortSignal } = {},
): Promise<Result<CargoLockfileInspection, AnalysisError>> =>
  inspectCargoArtifact(
    {
      operation,
      provider: CARGO_LOCKFILE_PROVIDER,
      querySchema: inspectCargoLockfileInputSchema,
      predicateType: "rea.cargo-lockfile-inventory",
      artifact: (path, sha256, bytes) => ({ path, sha256, bytes }),
      parse: parseCargoLockfile,
      limitationsOf: (report) => report.limitations,
    },
    rawInput,
    resources,
    options,
  );
