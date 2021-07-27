# Spigot builder

Only builds the spigot.jar

Project

[![License](https://img.shields.io/github/license/d3strukt0r/spigot-build)](LICENSE.md)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.0-4baaaa.svg)](.github/CODE_OF_CONDUCT.md)

main-branch (alias stable, latest)

[![GH Action CI/CD](https://github.com/D3strukt0r/spigot-build/workflows/CI/CD/badge.svg?branch=main)][gh-action]
<!--
[![Codacy grade](https://img.shields.io/codacy/grade/{id}/main)][codacy]
-->

<!--
develop-branch (alias nightly)

[![GH Action CI/CD](https://github.com/D3strukt0r/spigot-build/workflows/CI/CD/badge.svg?branch=develop)][gh-action]
[![Codacy grade](https://img.shields.io/codacy/grade/{id}/develop)][codacy]
-->

## Getting Started

These instructions will get you a copy of the project up and running on your local machine for development and testing purposes. See deployment for notes on how to deploy the project on a live system.

### Prerequisites

What things you need to install the software and how to install them

* Java 8 (For Spigot <= 1.16.5)
* Java 16+ (For Spigot >= 1.17)

### Installing

Download the Spigot version you want to from the [releases][gh-releases] page.

In the same directory create a shell script to run Spigot (where # is your allocated server memory in GB):

#### Windows (`start.bat`)

```bat
@echo off
java -Xms#G -Xmx#G -XX:+UseG1GC -jar spigot.jar nogui
pause
```

#### Linux (`start.sh`)

```shell
#!/bin/sh

java -Xms#G -Xmx#G -XX:+UseG1GC -jar spigot.jar nogui
```

and run `chmod a+x start.sh` to make it executable

#### Mac OS X (`start.sh`)

```shell
#!/bin/sh

cd "$( dirname "$0" )"
java -Xms#G -Xmx#G -XX:+UseG1GC -jar spigot.jar nogui
```

and run `chmod a+x start.sh` to make it executable

For more detail check the official [Spigot Wiki](https://www.spigotmc.org/wiki/spigot/).

## Built With

* [Spigot](https://www.spigotmc.org/wiki/spigot/) - The main software
* [Github Actions](https://github.com/features/actions) - CI (Testing) / CD (Deployment)
* [Docker](https://www.docker.com) - Containerization

## Contributing

Please read [CODE_OF_CONDUCT.md](.github/CODE_OF_CONDUCT.md) for details on our code of conduct, and [CONTRIBUTING.md](.github/CONTRIBUTING.md) for the process for submitting pull requests to us.

## Versioning

The is no project related versioning. The versions seen are the ones used for Minecraft. For changes see the [CHANGELOG.md](CHANGELOG.md) file. For the versions available, see the [tags on this repository][gh-tags].

## Authors

All the authors can be seen in the [AUTHORS.md](.github/AUTHORS.md) file.

Contributors can be seen in the [CONTRIBUTORS.md](.github/CONTRIBUTORS.md) file.

See also the full list of [contributors][gh-contributors] who participated in this project.

## License

This project is licensed under the GNU General Public License v3.0 - see the [LICENSE.md](LICENSE.md) file for details

## Acknowledgments

A list of used libraries and code with their licenses can be seen in the [ACKNOWLEDGMENTS.md](.github/ACKNOWLEDGMENTS.md) file.

[gh-action]: https://github.com/D3strukt0r/spigot-build/actions
[gh-releases]: https://github.com/D3strukt0r/spigot-build/releases
[gh-tags]: https://github.com/D3strukt0r/spigot-build/tags
[gh-contributors]: https://github.com/D3strukt0r/spigot-build/contributors
