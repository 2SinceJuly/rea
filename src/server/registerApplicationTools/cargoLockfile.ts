import type { EvidenceMcpServer } from "../EvidenceMcpServer.js";
import { inspectCargoLockfileEvidence } from "../../application/cargoLockfile/CargoLockfileService.js";
import { deliverCargoInspection } from "./cargoInventory.js";
import type { ApplicationToolRegistration } from "./types.js";

/** Reads use the server's existing artifact resource owner and Evidence session. */
export const registerCargoLockfileTool = (
  server: EvidenceMcpServer,
  options: ApplicationToolRegistration,
): void =>
  deliverCargoInspection(
    server,
    options,
    "inspect_cargo_lockfile",
    inspectCargoLockfileEvidence,
  );
