#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
deployer_key="$repo_root/_keys/devnet-test.json"
program_key="$repo_root/_keys/matchpot_escrow-program-keypair.json"

if [ ! -f "$deployer_key" ]; then
  echo "Missing funded devnet deployer: $deployer_key" >&2
  exit 1
fi

"$repo_root/scripts/anchor-build.sh"

cd "$repo_root"
anchor program deploy \
  --program-name matchpot_escrow \
  --program-keypair "$program_key" \
  --provider.cluster devnet \
  --provider.wallet "$deployer_key" \
  --no-idl

anchor idl upgrade \
  --filepath "$repo_root/target/idl/matchpot_escrow.json" \
  Diu1knrbYFraN5oSzjEW2RBjRW1obVo2iNz7vHDVrLET \
  --priority-fee 1000 \
  --provider.cluster devnet \
  --provider.wallet "$deployer_key"
