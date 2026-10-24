#!/usr/bin/env bash
# Refuse to release a version that is already released from another commit.
#
# usage: scripts/check-release-tag.sh <tag> <commit>
#
# A published version must never change: whoever installs v1.6.2-fmagent.1
# gets the same bundles every time. So a tag that already points at another
# commit means package.json's version was not bumped, and the release stops
# before anything is built. The same tag on the same commit is a re-run (an
# upload that failed part way) and may go ahead.
set -euo pipefail

tag=$1
commit=$2

refs=$(git ls-remote --tags origin "refs/tags/$tag" "refs/tags/$tag^{}")
if [ -z "$refs" ]; then
  echo "$tag is not released yet."
  exit 0
fi

# An annotated tag also lists "<tag>^{}", the commit it points at.
existing=$(grep -F "refs/tags/$tag^{}" <<<"$refs" | cut -f1 || true)
[ -n "$existing" ] || existing=$(cut -f1 <<<"$refs")

if [ "$existing" = "$commit" ]; then
  echo "$tag already points at $commit: re-running the release of the same commit."
  exit 0
fi

echo "::error::$tag is already released from $existing, not $commit. Bump the version in package.json, ui/package.json and package-lock.json before releasing."
exit 1
