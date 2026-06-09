{
  description = "Spigot/CraftBukkit server jars — built with BuildTools, published per Minecraft version, and exposed as hash-pinned flake fetches (+ an optional reproducible from-source build).";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
  };

  outputs = { self, nixpkgs }:
    let
      inherit (nixpkgs) lib;
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = f: lib.genAttrs systems (system: f (import nixpkgs { inherit system; }));

      owner = "Team-MaRo";
      repo = "spigot-build";
      releaseUrl = version: file:
        "https://github.com/${owner}/${repo}/releases/download/${version}/${file}";

      # version -> { spigot?, craftbukkit?, spigotApi? } SRI hashes of the
      # PUBLISHED jars. Populated automatically by CI (the record-hashes step)
      # after each release. May be partial (e.g. only `spigot`) — the fetch
      # packages below are built only for the keys that exist.
      versions = builtins.fromJSON (builtins.readFile ./versions.json);

      jarFiles = { spigot = "spigot.jar"; craftbukkit = "craftbukkit.jar"; spigotApi = "spigot-api.jar"; };

      # Build-time JDK per Minecraft version. Single source of truth shared with
      # .github/scripts/matrix.ts (both read ./jdk-boundaries.json). Each entry is
      # [ <lower-bound tuple> <jdk> ], newest-first; the first bound the version is
      # >= to wins (the [[0],"8"] entry is the fallback).
      #   <= 1.16.5 -> 8 · 1.17.x -> 16 · 1.18–1.20.4 -> 17 · 1.20.5–1.21.x -> 21 · >= 26.1 -> 25
      jdkBoundaries = builtins.fromJSON (builtins.readFile ./jdk-boundaries.json);
      jdkMajorFor = version:
        let
          tupleToVersion = t: lib.concatMapStringsSep "." toString t;
          match = lib.findFirst
            (b: lib.versionAtLeast version (tupleToVersion (builtins.elemAt b 0)))
            null
            jdkBoundaries;
        in if match == null then "8" else builtins.elemAt match 1;

      jdkForPkgs = pkgs: {
        "8" = pkgs.jdk8_headless;
        "16" = pkgs.jdk17_headless; # nixpkgs has no JDK 16; 1.17.x builds on 17
        "17" = pkgs.jdk17_headless;
        "21" = pkgs.jdk21_headless;
        "25" = pkgs.jdk25_headless;
      };

      # BuildTools build, pinned by NUMBER — an immutable artifact URL, unlike the
      # moving `lastSuccessfulBuild` (against which a fixed hash would go stale the
      # moment SpigotMC publishes a new build). Kept current by
      # .github/workflows/bump-buildtools.yml (probes lastSuccessfulBuild, bumps
      # both values). The two lines below are the bump script's sed anchors.
      buildToolsBuild = "4630";
      buildToolsHash = "sha256-th+pAVj1lO6VvqGic5nrZNQ5tMiuk0W9RHagLOSbBv8=";

      # Reproducible-from-source build (optional path, e.g. for docker-spigot-modded
      # that wants to build rather than fetch). BuildTools needs network (git
      # clones of BuildData/Bukkit/CraftBukkit/Spigot + the Mojang jar + Maven),
      # so this is a FIXED-OUTPUT derivation; stripJavaArchivesHook canonicalises
      # jar timestamps so the output is byte-stable for a pinned `hash`.
      #
      # To use: pass a dummy `hash` (lib.fakeHash), build once, copy the "got:" hash.
      buildSpigotWith = pkgs:
        let
          buildTools = pkgs.fetchurl {
            url = "https://hub.spigotmc.org/jenkins/job/BuildTools/${buildToolsBuild}/artifact/target/BuildTools.jar";
            hash = buildToolsHash;
          };
        in
        { version, jdkMajor ? jdkMajorFor version, hash }:
        let jdk = (jdkForPkgs pkgs).${jdkMajor} or pkgs.jdk25_headless;
        in pkgs.stdenv.mkDerivation {
          pname = "spigot";
          inherit version;
          dontUnpack = true;
          nativeBuildInputs = [ jdk pkgs.git pkgs.cacert pkgs.stripJavaArchivesHook ];

          buildPhase = ''
            runHook preBuild
            # BuildTools (and the Maven it shells out to) need a writable HOME for
            # the local .m2 repo; the sandbox default /var/empty is read-only.
            export HOME="$NIX_BUILD_TOP"
            export MAVEN_OPTS="-Dmaven.repo.local=$HOME/.m2/repository -Duser.home=$HOME"
            export SSL_CERT_FILE="${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
            export GIT_SSL_CAINFO="$SSL_CERT_FILE"
            java -Xmx4G -jar ${buildTools} --rev ${version} --compile spigot,craftbukkit -o out
            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall
            mkdir -p "$out"
            cp out/spigot-*.jar "$out/spigot.jar"
            cp out/craftbukkit-*.jar "$out/craftbukkit.jar"
            runHook postInstall
          '';

          outputHashAlgo = "sha256";
          outputHashMode = "recursive";
          outputHash = hash;
        };
    in
    {
      # Hash-pinned fetches of the published jars — the primary consumer API.
      # Nested (version keys) → legacyPackages, not packages (which `nix flake
      # check` requires to be a flat set of derivations).
      #   nix build '.#legacyPackages.x86_64-linux.spigotJar."26.1.2"'
      #   downstream: spigot-build.legacyPackages.${system}.spigotJar."26.1.2"
      legacyPackages = forAllSystems (pkgs:
        let
          fetchFor = which:
            lib.mapAttrs
              (version: meta: pkgs.fetchurl {
                url = releaseUrl version jarFiles.${which};
                hash = meta.${which};
              })
              (lib.filterAttrs (_: meta: meta ? ${which}) versions);
        in
        {
          spigotJar = fetchFor "spigot";
          craftbukkitJar = fetchFor "craftbukkit";
          spigotApiJar = fetchFor "spigotApi";
        });

      lib = {
        # Released versions (single source for a downstream image matrix).
        versions = builtins.attrNames versions;

        # Minecraft version -> required JDK major (string). Works for any version
        # (comparator), not only released ones.
        inherit jdkMajorFor;

        # Fetch one published jar by version. `which` ∈ spigot|craftbukkit|spigotApi.
        fetchSpigotJar = { pkgs, version, which ? "spigot" }:
          pkgs.fetchurl {
            url = releaseUrl version jarFiles.${which};
            hash = versions.${version}.${which};
          };

        # Reproducible from-source build (see buildSpigotWith).
        buildSpigot = { pkgs, version, jdkMajor ? jdkMajorFor version, hash }:
          buildSpigotWith pkgs { inherit version jdkMajor hash; };
      };
    };
}
