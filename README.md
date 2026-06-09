# spigot-build

Builds **Spigot** and **CraftBukkit** server jars with
[BuildTools](https://www.spigotmc.org/wiki/buildtools/) and publishes a GitHub
Release per Minecraft version — and exposes them as **hash-pinned Nix fetches** so
other flakes can consume the finished jar without rebuilding.

Spigot's licence forbids redistributing the compiled jar, so it is compiled here
(per version) and distributed via this repo's Releases; the jars are never vendored
into the source tree.

[![License](https://img.shields.io/github/license/Team-MaRo/spigot-build)](LICENSE.txt)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.0-4baaaa)][code-of-conduct]

## How it works

- CI (`.github/workflows/build.yml`) discovers buildable versions from the
  [SpigotMC hub](https://hub.spigotmc.org/versions/), builds each with the JDK it
  needs, **normalizes the jars** (`strip-nondeterminism`, so a rebuild of
  unchanged sources is byte-identical → stable hash), and publishes them to a
  Release tagged with the Minecraft version (on an orphan `builds` branch).
- A `record-hashes` job writes each published jar's SRI `sha256` into
  [`versions.json`](versions.json) and commits it — the auto-maintained pin source.
- `flake.nix` turns `versions.json` into hash-pinned `fetchurl` packages.

The matrix is minimal: a built version's jar never changes, so it builds versions
with **no release yet** plus always rebuilds the **newest 3** (in case the latest
got a late patch or a BuildTools fix). Runs weekly, on manual dispatch
(`latest`/`all`/`missing`/a specific version), and on PRs (smoke build, never
released).

## Consuming the jars (from another flake)

```nix
{
  inputs.spigot-build.url = "github:Team-MaRo/spigot-build";
  outputs = { self, nixpkgs, spigot-build }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
    in {
      # Pinned fetch of the published jar (fast — no rebuild):
      packages.${system}.jar = spigot-build.legacyPackages.${system}.spigotJar."26.1.2";
      #   …also craftbukkitJar / spigotApiJar
      #   spigot-build.lib.fetchSpigotJar { inherit pkgs; version = "26.1.2"; }
      #   spigot-build.lib.jdkMajorFor "26.1.2"   # -> "25"
      #   spigot-build.lib.versions               # released version list

      # Or build from source reproducibly (BuildTools FOD; supply a hash):
      packages.${system}.fromSource = spigot-build.lib.buildSpigot {
        inherit pkgs; version = "26.1.2"; hash = "sha256-…";
      };
    };
}
```

Pick up new versions / rebuilt hashes with `nix flake update spigot-build`. This is
how [docker-spigot](https://github.com/D3strukt0r/docker-spigot) consumes the jar
(it bakes the pinned fetch into the image).

```sh
# Build a pinned jar directly:
nix build '.#legacyPackages.x86_64-linux.spigotJar."26.1.2"'   # -> result (spigot.jar)
```

## JDK per Minecraft version

| Spigot / Minecraft version | JDK |
| -------------------------- | --- |
| ≤ 1.16.5                   | 8   |
| 1.17 – 1.17.1              | 16  |
| 1.18 – 1.20.4              | 17  |
| 1.20.5 – 1.21.11           | 21  |
| ≥ 26.1 (year-based)        | 25  |

Minecraft moved to year-based versioning after 1.21.11 (next release 26.1), which
is why the newest jars build on JDK 25. The boundaries live in
`.github/scripts/matrix.ts` (`JDK_BOUNDARIES`) and `flake.nix` (`jdkMajorFor`).

## Contributing

Please read [CONTRIBUTING.md][contributing] for details on our code of conduct and the process for submitting pull requests.

This project uses [Conventional Commits](https://www.conventionalcommits.org/).

## Versioning

We use [SemVer](http://semver.org/) for versioning. For available versions, see the [tags on this repository][gh-tags].

## Authors

### Special thanks for all the people who had helped this project so far

- **Manuele** - [D3strukt0r](https://github.com/D3strukt0r)

See also the full list of [contributors][gh-contributors] who participated in this project.

### I would like to join this list. How can I help the project?

We're currently looking for contributions for the following:

- [ ] Bug fixes
- [ ] Translations
- [ ] etc...

For more information, please refer to our [CONTRIBUTING.md][contributing] guide.

## License

This project is licensed under the MIT License - see the [LICENSE.txt](LICENSE.txt) file for details.

## Acknowledgments

This project currently uses no third-party libraries or copied code.

[gh-tags]: https://github.com/Team-MaRo/spigot-build/tags
[gh-contributors]: https://github.com/Team-MaRo/spigot-build/contributors
[contributing]: https://github.com/Team-MaRo/.github/blob/master/CONTRIBUTING.md
[code-of-conduct]: https://github.com/Team-MaRo/.github/blob/master/CODE_OF_CONDUCT.md
