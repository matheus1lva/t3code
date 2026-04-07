/**
 * providerCommands - Schemas for discovering provider CLI slash commands and skills.
 *
 * The web composer uses these to populate the `/` and `$` autocomplete menus
 * with commands/skills shipped by the underlying CLI (Codex/Claude) plus any
 * project- or user-scoped overrides.
 */
import { Schema } from "effect";

import { TrimmedNonEmptyString } from "./baseSchemas";
import { ProviderKind } from "./orchestration";

export const ProviderCommandSource = Schema.Literals(["builtin", "user", "project"]);
export type ProviderCommandSource = typeof ProviderCommandSource.Type;

export const ProviderCommandEntry = Schema.Struct({
  name: TrimmedNonEmptyString,
  description: Schema.String,
  source: ProviderCommandSource,
});
export type ProviderCommandEntry = typeof ProviderCommandEntry.Type;

export const ProviderCommandsListInput = Schema.Struct({
  provider: ProviderKind,
  cwd: Schema.optional(TrimmedNonEmptyString),
});
export type ProviderCommandsListInput = typeof ProviderCommandsListInput.Type;

export const ProviderCommandsListResult = Schema.Struct({
  provider: ProviderKind,
  commands: Schema.Array(ProviderCommandEntry),
  skills: Schema.Array(ProviderCommandEntry),
});
export type ProviderCommandsListResult = typeof ProviderCommandsListResult.Type;

export class ProviderCommandsListError extends Schema.TaggedErrorClass<ProviderCommandsListError>()(
  "ProviderCommandsListError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}
