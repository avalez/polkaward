const { Abi } = require('@polkadot/api-contract');
const { u8aToHex } = require('@polkadot/util');
const fs = require('fs');

const metadata = JSON.parse(fs.readFileSync('./target/ink/polkaward.json', 'utf8'));
const abi = new Abi(metadata);

const constructor = abi.constructors.find(c => c.identifier === 'new');
// padding 20 bytes to 32 bytes
const provider = '0x' + '22'.repeat(32);
const arbitrator = '0x' + '11'.repeat(32);
const duration = 100;

try {
    const encoded = constructor.toU8a([provider, arbitrator, duration]);
    console.log("Encoded payload:", u8aToHex(encoded));
} catch (e) {
    console.error("toU8a error:", e);
}
