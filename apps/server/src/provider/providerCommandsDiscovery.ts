/**
 * providerCommandsDiscovery - Filesystem discovery for CLI slash commands and skills.
 *
 * Both Codex and Claude expose user/project scoped commands and skills via
 * markdown files under well-known directories. We scan those directories and
 * project them into a uniform shape for the composer autocomplete menus.
 *
 * Discovery layout (per provider):
 *   ~/.<provider>/commands/<name>.md      → user commands
 *   <cwd>/.<provider>/commands/<name>.md  → project commands
 *   ~/.<provider>/skills/<name>/SKILL.md  → user skills
 *   <cwd>/.<provider>/skills/<name>/SKILL.md → project skills
 *
 * Codex's CLI also supports `~/.codex/prompts` for slash commands; we treat
 * that as an additional source so users with existing Codex prompts get them
 * surfaced automatically.
 */
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import {
  type ProviderCommandEntry,
  type ProviderCommandsListInput,
  type ProviderCommandsListResult,
  type ProviderCommandSource,
  type ProviderKind,
} from "@t3tools/contracts";
import { Data, Effect } from "effect";

export class ProviderCommandsDiscoveryError extends Data.TaggedError(
  "ProviderCommandsDiscoveryError",
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

interface ProviderLayout {
  readonly directoryNames: ReadonlyArray<string>;
  readonly commandSubpaths: ReadonlyArray<string>;
  readonly skillSubpaths: ReadonlyArray<string>;
}

const PROVIDER_LAYOUTS: Record<ProviderKind, ProviderLayout> = {
  codex: {
    directoryNames: [".codex"],
    commandSubpaths: ["commands", "prompts"],
    skillSubpaths: ["skills"],
  },
  claudeAgent: {
    directoryNames: [".claude"],
    commandSubpaths: ["commands"],
    skillSubpaths: ["skills"],
  },
};

const DESCRIPTION_PATTERN = /^description\s*[:=]\s*(.+)$/im;
const FRONTMATTER_PATTERN = /^---\s*\n([\s\S]*?)\n---\s*/;

function stripExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function extractDescription(content: string): string {
  const frontmatter = FRONTMATTER_PATTERN.exec(content);
  if (frontmatter?.[1]) {
    const match = DESCRIPTION_PATTERN.exec(frontmatter[1]);
    if (match?.[1]) {
      return match[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  const body = frontmatter ? content.slice(frontmatter[0].length) : content;
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    return trimmed.length > 160 ? `${trimmed.slice(0, 157)}...` : trimmed;
  }
  return "";
}

async function safeReadFile(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function readDirEntries(path: string) {
  try {
    return await fs.readdir(path, { withFileTypes: true });
  } catch {
    return null;
  }
}

async function collectCommandsFromDir(
  dir: string,
  source: ProviderCommandSource,
): Promise<ProviderCommandEntry[]> {
  const entries = await readDirEntries(dir);
  if (!entries) return [];
  const out: ProviderCommandEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith(".md")) continue;
    const name = stripExtension(entry.name);
    if (!name) continue;
    const content = (await safeReadFile(join(dir, entry.name))) ?? "";
    out.push({ name, description: extractDescription(content), source });
  }
  return out;
}

async function collectSkillsFromDir(
  dir: string,
  source: ProviderCommandSource,
): Promise<ProviderCommandEntry[]> {
  const entries = await readDirEntries(dir);
  if (!entries) return [];
  const out: ProviderCommandEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = join(dir, entry.name);
    const skillFile =
      (await safeReadFile(join(skillDir, "SKILL.md"))) ??
      (await safeReadFile(join(skillDir, "skill.md")));
    if (skillFile === null) continue;
    out.push({
      name: basename(entry.name),
      description: extractDescription(skillFile),
      source,
    });
  }
  return out;
}

function dedupeByName(entries: ReadonlyArray<ProviderCommandEntry>): ProviderCommandEntry[] {
  // Project entries take precedence over user entries with the same name.
  const sourceRank: Record<ProviderCommandSource, number> = {
    project: 0,
    user: 1,
    builtin: 2,
  };
  const byName = new Map<string, ProviderCommandEntry>();
  for (const entry of entries) {
    const existing = byName.get(entry.name);
    if (!existing || sourceRank[entry.source] < sourceRank[existing.source]) {
      byName.set(entry.name, entry);
    }
  }
  return [...byName.values()].toSorted((a, b) => a.name.localeCompare(b.name));
}

async function discoverInternal(
  input: ProviderCommandsListInput,
): Promise<ProviderCommandsListResult> {
  const layout = PROVIDER_LAYOUTS[input.provider];
  const home = homedir();
  const roots: ReadonlyArray<{ root: string; source: ProviderCommandSource }> = [
    ...layout.directoryNames.map((dir) => ({
      root: join(home, dir),
      source: "user" as const,
    })),
    ...(input.cwd
      ? layout.directoryNames.map((dir) => ({
          root: join(input.cwd!, dir),
          source: "project" as const,
        }))
      : []),
  ];

  const commandResults: ProviderCommandEntry[] = [];
  const skillResults: ProviderCommandEntry[] = [];

  await Promise.all(
    roots.map(async ({ root, source }) => {
      await Promise.all([
        ...layout.commandSubpaths.map(async (sub) => {
          commandResults.push(...(await collectCommandsFromDir(join(root, sub), source)));
        }),
        ...layout.skillSubpaths.map(async (sub) => {
          skillResults.push(...(await collectSkillsFromDir(join(root, sub), source)));
        }),
      ]);
    }),
  );

  return {
    provider: input.provider,
    commands: dedupeByName(commandResults),
    skills: dedupeByName(skillResults),
  };
}

export const discoverProviderCommands = (
  input: ProviderCommandsListInput,
): Effect.Effect<ProviderCommandsListResult, ProviderCommandsDiscoveryError> =>
  Effect.tryPromise({
    try: () => discoverInternal(input),
    catch: (cause) =>
      new ProviderCommandsDiscoveryError({
        message: cause instanceof Error ? cause.message : "Failed to discover provider commands",
        cause,
      }),
  });
