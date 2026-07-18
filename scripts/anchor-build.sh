#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
program_key="$repo_root/_keys/nextgoal_escrow-program-keypair.json"
deploy_key="$repo_root/target/deploy/nextgoal_escrow-keypair.json"

if [ ! -f "$program_key" ]; then
  echo "Missing $program_key" >&2
  echo "Restore the backed-up NextGoal program keypair before building." >&2
  exit 1
fi

mkdir -p "$repo_root/target/deploy"
cp "$program_key" "$deploy_key"
chmod 600 "$deploy_key"

cd "$repo_root"
anchor build
