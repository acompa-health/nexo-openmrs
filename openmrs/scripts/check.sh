#!/usr/bin/env bash
# The openmrs/ checks: types, tests, the committed build, and the backend module. Run from anywhere.
#
#   scripts/check.sh                  # every step, in order
#   scripts/check.sh types test build # only these steps (CI runs omod in its own job)
#
# types, test and build need only Bun (run `bun install` in openmrs/ first). omod needs Docker.
# Exits non-zero on the first failing step.
set -euo pipefail
cd "$(dirname "$0")/.."
# `git rebase --exec` exports GIT_DIR. Without GIT_WORK_TREE, git then takes this folder as the top of the work tree
# and the build step compares the wrong paths. Let git find the repository from here instead.
unset GIT_DIR GIT_WORK_TREE

# Maven 3.9.16 with Temurin 21, pinned by digest (amd64 and arm64).
MAVEN_IMAGE='maven:3.9-eclipse-temurin-21@sha256:99e61abcff91a9b1333463bd8451fb18495d6eba9250ac66a338b518f8278320'

step() { printf '\n== %s\n' "$*"; }

run_step() {
  case "$1" in
    types) step types; bun run typecheck ;;
    test)  step test;  bun run test ;;
    build)
      # Prepare the protocol in full (about a minute), compile it, and require the build that git has (staged or
      # committed): no changed, deleted or new file in any protocols/*/build/ folder.
      step build
      bun run build:protocol
      bun run compile
      if ! git diff --quiet -- 'protocols/*/build/*' || [ -n "$(git ls-files --others --exclude-standard -- 'protocols/*/build/*')" ]; then
        git status --short -- 'protocols/*/build/*'
        echo "check.sh: a fresh build differs from the build in git. Commit the output of 'bun run build:protocol && bun run compile'." >&2
        exit 1
      fi ;;
    omod)
      step omod
      docker run --rm -v "$PWD/omod":/src -v nexo-m2:/root/.m2 -w /src "$MAVEN_IMAGE" mvn -B -ntp package
      ls omod/omod/target/nexo-*.omod ;;
    *) echo "check.sh: unknown step '$1' (types, test, build, omod)" >&2; exit 2 ;;
  esac
}

steps=("$@")
if [ ${#steps[@]} -eq 0 ]; then
  steps=(types test build omod)
fi
start=$(date +%s)
for s in "${steps[@]}"; do
  run_step "$s"
done
echo; echo "check.sh: all green (${steps[*]}) in $(( $(date +%s) - start ))s"
