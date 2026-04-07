import type { ProviderCommandsListResult, ProviderKind } from "@t3tools/contracts";
import { queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

export const providerCommandsQueryKeys = {
  all: ["provider-commands"] as const,
  list: (provider: ProviderKind, cwd: string | null) =>
    ["provider-commands", "list", provider, cwd] as const,
};

const EMPTY_PROVIDER_COMMANDS_RESULT: ProviderCommandsListResult = {
  provider: "codex",
  commands: [],
  skills: [],
};

const DEFAULT_STALE_TIME = 30_000;

export function providerCommandsQueryOptions(input: {
  provider: ProviderKind;
  cwd: string | null;
  enabled?: boolean;
  staleTime?: number;
}) {
  return queryOptions({
    queryKey: providerCommandsQueryKeys.list(input.provider, input.cwd),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.providers.listCommands({
        provider: input.provider,
        ...(input.cwd ? { cwd: input.cwd } : {}),
      });
    },
    enabled: input.enabled ?? true,
    staleTime: input.staleTime ?? DEFAULT_STALE_TIME,
    placeholderData: (previous) =>
      previous ?? { ...EMPTY_PROVIDER_COMMANDS_RESULT, provider: input.provider },
  });
}
