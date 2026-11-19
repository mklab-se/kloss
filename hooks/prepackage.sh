#!/bin/sh
# Prints the version about to be deployed and warns (never blocks) when it is not exactly a
# release: uncommitted changes, or a commit that is not the release tag. The build string is
# written to build-info.txt, which the image carries, so /healthz shows exactly what runs.
set -e
version=$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' package.json | head -1)
sha=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)
tag=$(git describe --tags --exact-match 2>/dev/null || true)
dirty=$(git status --porcelain 2>/dev/null | grep -v 'build-info.txt' || true)

build="$version"
if [ -n "$dirty" ]; then
  build="$sha-dirty"
  echo "WARNING: deploying uncommitted changes (kloss $version+$build)." >&2
elif [ "$tag" != "v$version" ]; then
  build="$sha"
  echo "WARNING: deploying commit $sha, which is not the v$version release (kloss $version+$build)." >&2
fi
printf '%s\n' "$build" > build-info.txt
if [ "$build" = "$version" ]; then
  echo "Deploying kloss $version."
else
  echo "Deploying kloss $version+$build."
fi
