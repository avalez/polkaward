#!/usr/bin/env bash
set -euo pipefail

mnemonic="${1:-${MNEMONIC:-}}"

if [[ -z "$mnemonic" ]]; then
  echo "Missing mnemonic" >&2
  exit 1
fi

echo "Running key derivation..." >&2

export MNEMONIC="$mnemonic"

output="$(
  pnpm exec node --input-type=module -e '
    import {
      mnemonicToEntropy,
      entropyToMiniSecret
    } from "@polkadot-labs/hdkd-helpers";

    const entropy = mnemonicToEntropy(process.env.MNEMONIC);
    console.log(`BIP39 0x${Buffer.from(entropy).toString("hex")}`);

    const miniSecret = entropyToMiniSecret(entropy);
    console.log(`HDKD 0x${Buffer.from(miniSecret).toString("hex")}`);
  '
)"

if [[ -z "$output" ]]; then
  echo "Key derivation produced no output" >&2
  exit 1
fi

printf '%s\n' "$output"