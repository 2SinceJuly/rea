import type { EvidenceMcpServer } from "../EvidenceMcpServer.js";
import { inspectCargoManifestEvidence } from "../../application/cargoManifest/CargoManifestService.js";
import { deliverCargoInspection } from "./cargoInventory.js";
import type { ApplicationToolRegistration } from "./types.js";

/** Reads use the server's existing artifact resource owner and Evidence session. */
export const registerCargoManifestTool = (
  server: EvidenceMcpServer,
  options: ApplicationToolRegistration,
): void =>
  deliverCargoInspection(
    server,
    options,
    "inspect_cargo_manifest",
    inspectCargoManifestEvidence,
  );
