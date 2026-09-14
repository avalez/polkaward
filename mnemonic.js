const bip39 = require('bip39');

const privateEntropy = '0xe161b424966b6234e2e04e14265e7c5e';
const privateEntropyHex = privateEntropy.replace(/^0x/i, '');

if (!/^(?:[0-9a-f]{32}|[0-9a-f]{40}|[0-9a-f]{48}|[0-9a-f]{56}|[0-9a-f]{64})$/i.test(privateEntropyHex)) {
  throw new Error('Entropy must be 16, 20, 24, 28, or 32 bytes of hexadecimal data');
}

const mnemonic = bip39.entropyToMnemonic(
  Buffer.from(privateEntropyHex, 'hex')
);

process.stdout.write(`${mnemonic}\n`);