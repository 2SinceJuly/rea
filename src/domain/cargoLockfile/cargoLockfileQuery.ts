import { z } from "zod";
import { localPathStringSchema } from "../localPath.js";
import { CARGO_LOCKFILE_MAX_FILE_BYTES } from "./cargoLockfile.js";

export const inspectCargoLockfileInputSchema = z.strictObject({
  path: localPathStringSchema.describe(
    "Absolute path to one local Cargo.lock file",
  ),
  format: z.literal("cargo-lock").default("cargo-lock"),
  max_file_bytes: z
    .int()
    .positive()
    .max(CARGO_LOCKFILE_MAX_FILE_BYTES)
    .default(CARGO_LOCKFILE_MAX_FILE_BYTES)
    .describe(
      "Maximum lockfile bytes read (up to 32 MiB); this does not adjust parser allowances",
    ),
});
export type InspectCargoLockfileInput = z.output<
  typeof inspectCargoLockfileInputSchema
>;
