import type { EvidenceMcpServer } from "../EvidenceMcpServer.js";
import { runAdmittedToolOperation } from "../admittedToolOperation.js";
import type { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import { toolContract } from "../../contracts/toolContracts.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type { Evidence } from "../../domain/evidence.js";
import type { Result } from "../../domain/result.js";
import { toolRegistrationOptions } from "../toolRegistrationOptions.js";
import { logToolExecution } from "../toolLogging.js";
import { deliverApplicationEvidence } from "./helpers.js";
import type { ApplicationToolRegistration } from "./types.js";

type CargoInspection = Result<
  {
    readonly evidence: Evidence;
    readonly observation: {
      readonly path: string;
      readonly sha256: string;
      readonly bytes: number;
    };
  },
  AnalysisError
>;

/**
 * Register one read-only Cargo inventory operation whose Evidence, partial
 * observations and admission all follow the same shape.
 */
export const deliverCargoInspection = (
  server: EvidenceMcpServer,
  options: ApplicationToolRegistration,
  name: "inspect_cargo_manifest" | "inspect_cargo_lockfile",
  inspect: (
    input: unknown,
    resources: ArtifactResourceScope,
    inspectOptions: { readonly signal?: AbortSignal },
  ) => Promise<CargoInspection>,
): void => {
  const contract = toolContract(name);
  server.registerTool(
    contract.name,
    toolRegistrationOptions(contract),
    async (input, context) =>
      runAdmittedToolOperation(
        server,
        options.withAdmittedAnalysis,
        contract.name,
        context.mcpReq.signal,
        async () => {
          const result = await logToolExecution(
            options.logger,
            contract.name,
            () =>
              inspect(input, options.artifactResources, {
                signal: context.mcpReq.signal,
              }),
          );
          if (!result.ok)
            return server.delivery.toPartialErrorToolResult(
              result.error,
              contract.returnsTargetContent,
              options.recordEvidence,
            );
          // A cancellation after the read and inventory completes must not discard
          // the observed file; deliver it instead of a bare cancellation.
          return deliverApplicationEvidence(
            server,
            options,
            contract,
            { evidence: result.value.evidence, sources: [] },
            undefined,
            context.mcpReq.signal,
            undefined,
            result.value.observation,
          );
        },
      ),
  );
};
