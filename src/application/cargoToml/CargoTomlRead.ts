import { constants } from "node:buffer";
import { parse as parseToml } from "smol-toml";
import type { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";
import {
  artifactFileCancellationCause,
  artifactFilePrimaryFacts,
} from "../../artifacts/ArtifactFileOperation.js";
import { readStableArtifact } from "../../artifacts/readStableArtifact.js";
import {
  projectStableArtifactFailure,
  stableArtifactInputRecovery,
} from "../../artifacts/StableArtifactFailure.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisAccessDeniedError,
  AnalysisArtifactChangedError,
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisResourceConstraintError,
} from "../../domain/analysisErrorCore.js";
import { ArtifactOperationError } from "../../domain/artifactOperationError.js";
import { err, ok, type Result } from "../../domain/result.js";

/** The operations that admit a UTF-8 TOML artifact for offline Cargo inventory. */
export type CargoTomlOperation =
  | typeof import("../../domain/cargoManifest/cargoManifest.js").CARGO_MANIFEST_OPERATION
  | typeof import("../../domain/cargoLockfile/cargoLockfile.js").CARGO_LOCKFILE_OPERATION;

const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

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

/** Keep the reader's typed reasons instead of flattening every failure into "io". */
const readFailure = (
  operation: CargoTomlOperation,
  failure: unknown,
  path: string,
  maxFileBytes: number,
): AnalysisError => {
  const { cause, origin } = artifactFilePrimaryFacts(failure);
  if (
    origin === "owned-or-classified" &&
    cause instanceof ArtifactReaderFailure
  ) {
    if (cause.reason === "cancelled")
      return new AnalysisCancelledError(operation, {
        cause: artifactFileCancellationCause(cause),
      });
    if (cause.reason === "integrity")
      return new AnalysisArtifactChangedError(operation, path, cause.message, {
        cause,
      });
    if (cause.reason === "limit")
      return new AnalysisResourceConstraintError(
        operation,
        cause.boundary ?? "file-size",
        cause.message,
        { max_file_bytes: maxFileBytes },
        {
          cause,
          retryable: false,
          remediationAction:
            "Select a file within max_file_bytes; reply paging does not change this file admission.",
        },
      );
    if (cause.reason === "path" || cause.reason === "format")
      return inputFailure(operation, cause.message, cause);
  }
  if (cause instanceof Error && "code" in cause) {
    if (cause.code === "EACCES" || cause.code === "EPERM")
      return new AnalysisAccessDeniedError(operation, path, cause.code, {
        cause,
      });
  }
  return new ArtifactOperationError(
    operation,
    "io",
    undefined,
    "TOML artifact read failed.",
    { cause: failure },
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
    text = UTF8.decode(bytes);
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
