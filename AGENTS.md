# AGENTS.md

Guidance for working in this repository. Single source of truth — `CLAUDE.md`
just points here.

## What this is

`spigot-build` builds **Spigot** and **CraftBukkit** server jars with
[BuildTools](https://www.spigotmc.org/wiki/buildtools/) and **publishes a GitHub
Release per Minecraft version** (Spigot's licence forbids redistributing the
compiled jar, so it is compiled here, per version, never vendored). It is the
single source of truth for the jars + their hashes.

Consumers (e.g. [docker-spigot](https://github.com/D3strukt0r/docker-spigot),
and a future `docker-spigot-modded`) take the **finished jar** as a **hash-pinned
`fetchurl`** via this repo's flake — fast, reproducible, and pure (no rebuild).
A reproducible **from-source** build is also available for those who want it.

## How the pieces fit

- **`.github/scripts/matrix.ts`** — discovers buildable versions from the
  SpigotMC hub, maps each to its build JDK (`JDK_BOUNDARIES`), and selects which
  to build (`missing` + newest N by default; `latest`/`all`/`all-released`/a
  specific version on dispatch). Prints a `{spigot, java}[]` matrix.
- **`.github/workflows/build.yml`**:
  - `matrix` job — runs matrix.ts; ensures the orphan **`builds`** branch exists
    (release tags target it, so re-releasing never moves master history).
  - `build-jars` job — per version: BuildTools `--compile spigot,craftbukkit`,
    collect `spigot.jar`/`craftbukkit.jar`/`spigot-api.jar`, **`strip-nondeterminism`**
    them (so a rebuild of unchanged sources yields byte-identical jars → stable
    hash), publish via `ncipollo` (tag = MC version, on `builds`), and emit each
    jar's SRI sha256 as a `hash-<ver>` artifact.
  - `record-hashes` job — single job (no write race) that merges the hash
    artifacts into **`versions.json`** and commits it to `master`. This is what
    keeps the pinned hashes current; consumers pick them up with `nix flake update`.
  - keepalive (in the `matrix` job, schedule-only) — pushes an empty commit if
    `master` is idle past the threshold, so GitHub doesn't auto-disable the
    schedules. One keepalive re-arms every scheduled workflow in the repo.
- **`.github/workflows/check-outdated.yml`** — weekly watchdog: downloads the
  newest version's released `spigot.jar` and boots it (with the **StopOnStart**
  plugin); if the release is missing, the jar is broken, or Spigot prints the
  "outdated" banner, it dispatches `build.yml` to rebuild. (The build keeps jars
  *fresh*; this proves the published jar actually *works*.)
- **`.github/check-outdated/StopOnStart.java` + `plugin.yml`** — tiny Bukkit plugin
  (`onEnable()` → `getServer().shutdown()`) used by the watchdog to stop the bare
  server right after it boots.
- **`.github/workflows/bump-buildtools.yml`** — weekly: keeps the BuildTools pin
  in `flake.nix` (`buildToolsBuild` + `buildToolsHash`, used by `lib.buildSpigot`)
  current. Probes `lastSuccessfulBuild`; if newer than the pinned build NUMBER,
  fetches that build's hash and commits the bump (sed anchors on those two lines).
  We pin a build *number* (immutable URL), not `lastSuccessfulBuild`, so a fixed
  hash never goes stale between bumps.
- **`versions.json`** — `version → { spigot?, craftbukkit?, spigotApi? }` SRI
  hashes of the published jars. Auto-maintained; may be partial.
- **`flake.nix`** — consumer API:
  - `legacyPackages.<sys>.{spigotJar,craftbukkitJar,spigotApiJar}."<ver>"` —
    `fetchurl` of the published jar, pinned by the `versions.json` hash. (Nested →
    legacyPackages, since `nix flake check` requires flat `packages`.)
  - `lib.versions` — released version list (a single source for a downstream
    image matrix).
  - `lib.jdkMajorFor "<ver>"` — version → JDK major (comparator; mirrors matrix.ts).
  - `lib.fetchSpigotJar { pkgs; version; which ? "spigot"; }` — convenience fetch.
  - `lib.buildSpigot { pkgs; version; jdkMajor?; hash; }` — optional reproducible
    **from-source** build (BuildTools in a fixed-output derivation +
    `stripJavaArchivesHook`); caller supplies the `hash` (no pinned version map to
    maintain here).

## Consuming from another flake

```nix
inputs.spigot-build.url = "github:Team-MaRo/spigot-build";
# then, for a system/pkgs:
#   spigot-build.legacyPackages.${system}.spigotJar."26.1.2"   # pinned fetch (fast)
#   spigot-build.lib.fetchSpigotJar { inherit pkgs; version = "26.1.2"; }
#   spigot-build.lib.jdkMajorFor "26.1.2"                       # -> "25"
#   spigot-build.lib.buildSpigot { inherit pkgs; version = "26.1.2"; hash = "sha256-…"; }  # from source
```
Bump available versions/hashes with `nix flake update spigot-build`.

## JDK per Minecraft version

BuildTools needs a specific JDK per version. The boundaries live in one source of
truth, `jdk-boundaries.json` (project root), read by both `matrix.ts`
(`JDK_BOUNDARIES`) and `flake.nix` (`jdkMajorFor`):

| Spigot / Minecraft version | JDK |
| -------------------------- | --- |
| ≤ 1.16.5                   | 8   |
| 1.17 – 1.17.1              | 16  |
| 1.18 – 1.20.4              | 17  |
| 1.20.5 – 1.21.11           | 21  |
| ≥ 26.1 (year-based)        | 25  |

Minecraft moved to year-based versioning after 1.21.11 (next release 26.1), which
is why the newest jars build on JDK 25.

When a new Minecraft version bumps the required JDK, update `jdk-boundaries.json`
and the table above. References:

- BuildTools (build requirements): https://www.spigotmc.org/wiki/buildtools/
- Java version per Minecraft version: https://minecraft.wiki/w/Tutorial:Update_Java
- Azul Zulu JDK downloads: https://www.azul.com/downloads/?package=jdk#zulu

## Local build / verify

```bash
# Fetch a pinned published jar (after a release + versions.json entry exist):
nix build '.#legacyPackages.x86_64-linux.spigotJar."26.1.2"'

# Reproducible from-source build (dummy hash → build once → copy the "got:" hash):
nix build --impure --expr 'with import <nixpkgs> {}; (builtins.getFlake (toString ./.)).lib.buildSpigot { pkgs = import <nixpkgs>{}; version = "26.1.2"; hash = ""; }'
```

Nix flakes only see git-tracked files — stage new files before `nix` reads them,
or evaluate a non-git copy.

## Conventions & gotchas

- **Line endings:** `.gitattributes` forces LF (Nix reads `''…''` literally; CRLF
  breaks builds).
- **Hash stability hinges on `strip-nondeterminism`**: without it, every rebuild
  churns the published-jar hash even when Spigot's sources didn't change.
- **`versions.json` is machine-owned** (the `record-hashes` job). Don't hand-edit
  unless bootstrapping.
- **License:** the compiled Spigot/CraftBukkit jars are built here, never vendored
  into the repo; releases are the distribution point.
