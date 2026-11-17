import { constants } from "node:buffer";
import { parse as parseToml } from "smol-toml";

import {
  ArtifactReaderFailure,
  artifactFileCancellationCause,
  artifactFilePrimaryFacts,
  readStableArtifact,
  projectStableArtifactFailure,
  stableArtifactInputRecovery,
  type ArtifactResourceScope,
} from "../../resources/index.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisAccessDeniedError,
  AnalysisArtifactChangedError,
  AnalysisInputError,
  AnalysisResourceConstraintError,
  carriedReason,
  cancelledBy,
} from "../../domain/analysisErrorCore.js";
import { fixedAllowanceOptions } from "../../domain/fixedAllowanceRemediation.js";
import { ArtifactOperationError } from "../../domain/artifactOperationError.js";
import { decodeStrictUtf8 } from "../../domain/strictUtf8.js";
import { classifyProviderFailure, type ProviderFailureDialect } from "../../providers/classifyProviderFailure.js";
import { err, ok, type Result } from "../../domain/result.js";

/** The operations that admit a UTF-8 TOML artifact for offline Cargo inventory. */
export type CargoTomlOperation =
  | typeof import("../../domain/cargoManifest/cargoManifest.js").CARGO_MANIFEST_OPERATION
  | typeof import("../../domain/cargoLockfile/cargoLockfile.js").CARGO_LOCKFILE_OPERATION;


const inputFailure = (
  operation: CargoTomlOperation,
  message: string,
  cause?: unknown,
) =>
  new AnalysisInputError(
    operation,
    {
      cause,
      ...(cause instanceof ArtifactReaderFailure
        ? stableArtifactInputRecovery(cause)
        : {}),
    },
    [{ path: ["path"], reason: "invalid_format", message }],
  );

/**
 * Cargo's dialect for the shared provider failure classifier: the reader's
 * typed reasons survive instead of flattening into "io".
 */
const cargoFailureDialect = (
  operation: CargoTomlOperation,
  path: string,
  maxFileBytes: number,
): ProviderFailureDialect => ({
  providerId: operation,
  operation,
  recognise: (cause) =>
    cause instanceof ArtifactReaderFailure
      ? cargoReaderFailure(operation, cause, path, maxFileBytes)
      : undefined,
  unclassified: (cause) =>
    new ArtifactOperationError(
      operation,
      "io",
      undefined,
      "TOML artifact read failed.",
      { cause },
    ),
});

/** Map one reader failure onto the typed error Cargo reports for it. */
const cargoReaderFailure = (
  operation: CargoTomlOperation,
  cause: ArtifactReaderFailure,
  path: string,
  maxFileBytes: number,
): AnalysisError | undefined => {
  if (cause.reason === "cancelled")
    return cancelledBy(
      operation,
      carriedReason(artifactFileCancellationCause(cause)),
    );
  if (cause.reason === "integrity")
    return new AnalysisArtifactChangedError(operation, path, cause.message, {
      cause,
    });
  if (cause.reason === "limit")
    return new AnalysisResourceConstraintError(
      operation,
      "file-size",
      cause.message,
      { max_file_bytes: maxFileBytes },
      {
        cause,
        ...fixedAllowanceOptions("The Cargo TOML file allowance", "input", {
          limit: maxFileBytes,
          unit: "bytes",
        }),
      },
    );
  if (cause.reason === "path" || cause.reason === "format")
    return inputFailure(operation, cause.message, cause);
  return undefined;
};

const readFailure = (
  operation: CargoTomlOperation,
  failure: unknown,
  path: string,
  maxFileBytes: number,
): AnalysisError => {
  const { cause } = artifactFilePrimaryFacts(failure);
  if (cause instanceof Error && "code" in cause)
    if (cause.code === "EACCES" || cause.code === "EPERM")
      return new AnalysisAccessDeniedError(operation, path, cause.code, {
        cause,
      });
  return classifyProviderFailure(
    cause,
    cargoFailureDialect(operation, path, maxFileBytes),
  );
};

export interface CargoTomlSource {
  readonly bytes: Buffer;
  readonly sha256: string;
}

/** One verified file read shared by the manifest and lockfile importers. */
export const readCargoToml = async (
  operation: CargoTomlOperation,
  providerId: string,
  path: string,
  maxFileBytes: number,
  resources: ArtifactResourceScope,
  signal?: AbortSignal,
): Promise<Result<CargoTomlSource, AnalysisError>> => {
  try {
    const source = await resources.run(() =>
      readStableArtifact(path, maxFileBytes, signal, undefined, resources),
    );
    return ok(source);
  } catch (failure: unknown) {
    const primary = readFailure(operation, failure, path, maxFileBytes);
    return err(
      projectStableArtifactFailure(
        failure,
        primary,
        path,
        providerId,
        operation,
      ),
    );
  }
};

/** Decode one already-admitted file as TOML; smol-toml is the client-configuration owner's parser. */
export const decodeCargoToml = (
  operation: CargoTomlOperation,
  bytes: Buffer,
  path: string,
): Result<unknown, AnalysisError> => {
  if (bytes.includes(0))
    return err(
      inputFailure(
        operation,
        "Artifact bytes contain a NUL byte, so the file is not TOML text.",
      ),
    );
  // Equal byte lengths do not prove valid UTF-8: a malformed sequence can decode to
  // one replacement character that re-encodes to the same length. Decode fatally.
  let text: string;
  try {
    text = decodeStrictUtf8(bytes, "strip-signature");
  } catch (cause: unknown) {
    return err(
      inputFailure(
        operation,
        `Artifact at ${path} is not valid UTF-8 TOML text.`,
        cause,
      ),
    );
  }
  if (text.length > constants.MAX_STRING_LENGTH)
    return err(
      inputFailure(
        operation,
        `Artifact at ${path} exceeds the maximum in-memory string length.`,
      ),
    );
  try {
    return ok(parseToml(text));
  } catch (cause: unknown) {
    return err(inputFailure(operation, "Artifact is not valid TOML.", cause));
  }
};
