import { isAbsolute } from "node:path";
import type { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { AnalysisInputError } from "../../domain/analysisErrorCore.js";
import { createEvidence, type Evidence } from "../../domain/evidence.js";
import { err, ok, type Result } from "../../domain/result.js";
import { parseAnalysisInput } from "../AnalysisInput.js";
import { completeProviderEvidence } from "../ProviderOperationExecution.js";
import {
  decodeCargoToml,
  readCargoToml,
  type CargoTomlOperation,
} from "./CargoTomlRead.js";

/** What every offline Cargo inventory operation produces from one admitted file. */
export interface CargoInspection<TReport, TArtifact> {
  readonly evidence: Evidence;
  /** Observations completed before a cancellation, retained as partial evidence. */
  readonly observation: TArtifact;
}

export interface CargoInspectionRequest<TReport, TArtifact> {
  readonly operation: CargoTomlOperation;
  readonly provider: {
    readonly id: string;
    readonly name: string;
    readonly version: string;
  };
  readonly querySchema: import("zod").ZodType<{
    readonly path: string;
    readonly format: string;
    readonly max_file_bytes: number;
  }>;
  readonly predicateType: string;
  /** Project the verified artifact facts this report repeats. */
  readonly artifact: (path: string, sha256: string, bytes: number) => TArtifact;
  readonly parse: (
    document: unknown,
    artifact: TArtifact,
  ) => Result<TReport, AnalysisError>;
  readonly limitationsOf: (report: TReport) => readonly string[];
}

/**
 * Shared CLI/MCP import: one verified read, an offline parse, and Evidence whose
 * partial observations survive a cancellation or a decode failure.
 */
export const inspectCargoArtifact = async <TReport, TArtifact>(
  request: CargoInspectionRequest<TReport, TArtifact>,
  rawInput: unknown,
  resources: ArtifactResourceScope,
  options: { readonly signal?: AbortSignal } = {},
): Promise<Result<CargoInspection<TReport, TArtifact>, AnalysisError>> => {
  const { operation, provider } = request;
  const admitted = parseAnalysisInput(
    operation,
    rawInput,
    request.querySchema,
    options.signal,
  );
  if (!admitted.ok) return admitted;
  const input = admitted.value;
  if (!isAbsolute(input.path))
    return err(
      new AnalysisInputError(operation, undefined, [
        {
          path: ["path"],
          reason: "invalid_format",
          message: "Expected an absolute filesystem path on this host.",
        },
      ]),
    );
  const source = await readCargoToml(
    operation,
    provider.id,
    input.path,
    input.max_file_bytes,
    resources,
    options.signal,
  );
  if (!source.ok) return source;
  const { bytes, sha256 } = source.value;
  // The verified read is a completed observation; keep it even when the later
  // decode or inventory fails, so a malformed artifact still names its file.
  const retain = <T>(result: Result<T, AnalysisError>) => {
    if (!result.ok)
      result.error.retainPartialObservation({
        kind: "file-snapshot-hash",
        path: input.path,
        sha256,
        bytes: bytes.length,
      });
    return result;
  };
  const document = retain(decodeCargoToml(operation, bytes, input.path));
  if (!document.ok) return document;
  const artifact = request.artifact(input.path, sha256, bytes.length);
  const parsed = retain(request.parse(document.value, artifact));
  if (!parsed.ok) return parsed;
  const result = parsed.value;
  const evidence = await completeProviderEvidence(
    createEvidence({ path: input.path, format: "file", sha256 }, provider, {
      operation,
      predicateType: request.predicateType,
      parameters: {
        path: input.path,
        format: input.format,
        max_file_bytes: input.max_file_bytes,
      },
      result,
      confidence: "observed",
      limitations: request.limitationsOf(result),
      locations: [{ kind: "artifact-path", path: input.path }],
    }),
    options.signal,
  );
  return evidence.ok
    ? ok({ evidence: evidence.value, observation: artifact })
    : evidence;
};
