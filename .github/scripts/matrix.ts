#!/usr/bin/env -S npx -y tsx
/**
 * Build the CI matrix of Spigot versions to compile.
 *
 * Discovers buildable Spigot versions from https://hub.spigotmc.org/versions/,
 * optionally diffs them against the releases that already exist in this repo,
 * maps each version to the JDK required to build it, and prints a GitHub Actions
 * matrix (a JSON array of `{ spigot, java }` objects).
 *
 * The selection is intentionally minimal: an already-built version's jar never
 * changes, so by default we only build versions that have no release yet, plus
 * the newest N versions (in case the latest got a late patch or a BuildTools fix).
 *
 * Usage:
 *   npx tsx .github/scripts/matrix.ts --version missing --newest-n 3
 *
 * `--version` accepts:
 *   latest        only the single newest version
 *   all           every buildable version
 *   missing       (versions without a release) + the newest N  [default]
 *   all-released  every version that already has a release (used for Docker-only rebuilds)
 *   <x.y[.z]>     one specific version
 *
 * Existing releases come from `gh` (needs GITHUB_REPOSITORY + auth) unless
 * `--existing-file` is given. Buildable versions come from the SpigotMC hub
 * unless `--versions-file` is given. Both overrides exist for local testing.
 *
 * When GITHUB_OUTPUT is set, also writes `matrix=<json>` and `latest=<newest>`.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const HUB_VERSIONS_URL = "https://hub.spigotmc.org/versions/";

interface MatrixEntry {
  spigot: string;
  java: string;
  // Present (true) only for versions whose cold build needs the SpigotMC snapshot
  // repo seeded via ~/.m2/settings.xml; build.yml gates that step on this flag.
  snapshotRepo?: boolean;
}

// Build-time JDK requirement per Spigot/Minecraft version. Boundaries are
// half-open lower bounds: a version uses the JDK of the highest boundary it is
// >= to. Checked top-down (newest first), so the list is in descending order.
// Single source of truth shared with flake.nix (`jdkMajorFor`):
//   <= 1.16.5 -> 8 · 1.17.x -> 16 · 1.18–1.20.4 -> 17 · 1.20.5–1.21.x -> 21 · >= 26.1 -> 25
// See https://www.spigotmc.org/wiki/buildtools/ and README "Building the Spigot jars".
const JDK_BOUNDARIES = JSON.parse(
  readFileSync(new URL("../../jdk-boundaries.json", import.meta.url), "utf-8"),
) as ReadonlyArray<readonly [number[], string]>;

// Versions matrix.ts must skip because BuildTools builds a DIFFERENT version for
// them (ALIASED): Spigot points that rev's BuildData at a newer patch in the same
// line, so `--rev X` produces `spigot-Y.jar`. The target Y is built by its own
// matrix entry, so nothing is lost. Determined empirically by running BuildTools
// for every hub version (the probe in docker-spigot/buildtools/_results.json).
// Confirmed mapping:
//   1.8.4 1.8.5 1.8.6 1.8.7 → 1.8.8 · 1.10 → 1.10.2 · 1.11.1 → 1.11.2
//   1.20 → 1.20.1 · 1.20.3 → 1.20.4 · 1.20.5 → 1.20.6
//   1.21 → 1.21.1 · 1.21.2 → 1.21.3 · 1.21.7 → 1.21.8 · 1.21.9 → 1.21.10
//   26.1 → 26.1.2 · 26.1.1 → 26.1.2
//
// build.yml's "Verify built version" step is the durable guard: if Spigot re-points
// a rev's BuildData, that rev starts failing the assertion and gets added here.
// Treat this list as the current snapshot, not a permanent truth.
const ALIASED = [
  "1.8.4", "1.8.5", "1.8.6", "1.8.7", "1.10", "1.11.1",
  "1.20", "1.20.3", "1.20.5", "1.21", "1.21.2", "1.21.7", "1.21.9", "26.1", "26.1.1",
];
export const UNBUILDABLE = new Set(ALIASED);

// Versions that DO build, but whose own spigot-api POM has no usable dependency
// repository for net.md-5:bungeecord-chat:*-SNAPSHOT — it only offers the dead
// oss.sonatype.org (newer point releases in each line fixed their POM to list
// hub.spigotmc.org's public group). A cold CI build therefore can't resolve the
// dep and fails. These are tagged (not denied): build.yml writes a one-off
// ~/.m2/settings.xml pointing Maven at the live SpigotMC repo ONLY for these
// jobs, so the other versions' resolution (and published-jar hashes) is untouched.
export const NEEDS_SNAPSHOT_REPO = new Set(["1.8", "1.8.3", "1.9", "1.9.2", "1.11", "1.12"]);

/** Turn "1.20.4" into a comparable tuple [1, 20, 4]. */
export function parseVersion(version: string): number[] {
  return version.split(".").map((part) => Number.parseInt(part, 10));
}

/** Compare two version tuples (shorter tuple sorts before its longer prefix). */
export function compareVersions(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  // A shorter tuple (e.g. 1.17) sorts before its longer prefix (1.17.1).
  return a.length - b.length;
}

export function isAtLeast(version: number[], boundary: number[]): boolean {
  return compareVersions(version, boundary) >= 0;
}

/** Return the JDK major version (as a string) needed to build `version`. */
export function jdkFor(version: string): string {
  const parsed = parseVersion(version);
  for (const [boundary, jdk] of JDK_BOUNDARIES) {
    if (isAtLeast(parsed, [...boundary])) return jdk;
  }
  return "8";
}

export function sortVersions(versions: Iterable<string>): string[] {
  return [...new Set(versions)].sort((a, b) =>
    compareVersions(parseVersion(a), parseVersion(b)),
  );
}

/** Scrape the buildable version list from the SpigotMC hub. */
async function fetchBuildableVersions(): Promise<string[]> {
  const response = await fetch(HUB_VERSIONS_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${HUB_VERSIONS_URL}: HTTP ${response.status}`);
  }
  const html = await response.text();
  // Buildable revisions are exposed as "<name>.json" links. Keep only real
  // Minecraft versions: "<major>.<minor>[.<patch>]" with an optional "-preN"/"-rcN"
  // pre-release suffix, where major is 1 (legacy) or a two-digit year (26, 27, …
  // after Minecraft moved to year-based versioning following 1.21.11). Requiring a
  // "<major>.<minor>" dotted prefix excludes the page's bare build numbers
  // (1021.json) and build-number revs (1251-a.json). Pre-releases sort adjacent to
  // their release (parseVersion drops the suffix) — harmless, as a pre-release is
  // never the newest version, so `latest` is unaffected.
  const versions = new Set<string>();
  for (const match of html.matchAll(/href="([^"]+)\.json"/g)) {
    if (isVersionName(match[1])) versions.add(match[1]);
  }
  return sortVersions(versions);
}

/**
 * True for a buildable Minecraft version name as listed on the hub: a
 * "<major>.<minor>[.<patch>]" with an optional "-preN"/"-rcN" pre-release suffix.
 * Excludes the page's bare build numbers (1021) and build-number revs (1251-a).
 */
export function isVersionName(name: string): boolean {
  return /^\d{1,2}\.\d{1,2}(?:\.\d{1,2})?(?:-(?:pre|rc)\d+)?$/.test(name);
}

/** List tag names that already have a GitHub release in this repo. */
function fetchExistingReleases(): string[] {
  const repo = process.env.GITHUB_REPOSITORY ?? "{owner}/{repo}";
  const stdout = execFileSync(
    "gh",
    ["api", `repos/${repo}/releases`, "--paginate", "-q", ".[].tag_name"],
    { encoding: "utf-8" },
  );
  return stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

function readLines(path: string): string[] {
  return readFileSync(path, "utf-8").split("\n").map((line) => line.trim()).filter(Boolean);
}

/** Return the list of versions to act on for the given selector. */
export function selectVersions(
  selector: string,
  buildable: string[],
  existing: string[],
  newestN: number,
): string[] {
  if (buildable.length === 0) return [];

  switch (selector) {
    case "latest":
      return [buildable[buildable.length - 1]];
    case "all":
      return [...buildable];
    case "all-released": {
      const buildableSet = new Set(buildable);
      return sortVersions(existing.filter((v) => buildableSet.has(v)));
    }
    case "missing": {
      const existingSet = new Set(existing);
      const chosen = new Set(buildable.filter((v) => !existingSet.has(v)));
      // slice(-0) === slice(0) === the whole list, so guard newestN === 0.
      if (newestN > 0) for (const v of buildable.slice(-newestN)) chosen.add(v);
      return sortVersions(chosen);
    }
    default:
      // Specific version.
      return [selector];
  }
}

function parseArgs(argv: string[]): { version: string; newestN: number; versionsFile?: string; existingFile?: string; includeUnbuildable: boolean } {
  const opts = {
    version: "missing",
    newestN: Number.parseInt(process.env.NEWEST_N ?? "3", 10),
    versionsFile: undefined as string | undefined,
    existingFile: undefined as string | undefined,
    // Diagnostics only: keep the UNBUILDABLE (dead-dep + aliased) versions in the
    // list, so probe-versions.yml can attempt every rev the hub exposes.
    includeUnbuildable: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case "--version": opts.version = next(); break;
      case "--newest-n": opts.newestN = Number.parseInt(next(), 10); break;
      case "--versions-file": opts.versionsFile = next(); break;
      case "--existing-file": opts.existingFile = next(); break;
      case "--include-unbuildable": opts.includeUnbuildable = true; break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  const buildable = sortVersions(
    opts.versionsFile ? readLines(opts.versionsFile) : await fetchBuildableVersions(),
  ).filter((v) => opts.includeUnbuildable || !UNBUILDABLE.has(v));

  const needsExisting = opts.version === "missing" || opts.version === "all-released";
  const existing = needsExisting
    ? (opts.existingFile ? readLines(opts.existingFile) : fetchExistingReleases())
    : [];

  const versions = selectVersions(opts.version, buildable, existing, opts.newestN);
  const matrix: MatrixEntry[] = versions.map((spigot) => ({
    spigot,
    java: jdkFor(spigot),
    ...(NEEDS_SNAPSHOT_REPO.has(spigot) ? { snapshotRepo: true } : {}),
  }));
  const latest = buildable.length > 0 ? buildable[buildable.length - 1] : "";

  process.stdout.write(JSON.stringify(matrix) + "\n");

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    appendFileSync(githubOutput, `matrix=${JSON.stringify(matrix)}\nlatest=${latest}\n`);
  }
}

// Only run when executed directly (`tsx matrix.ts …`), not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
