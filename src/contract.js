const fs = require("fs");

const { ApiPromise, WsProvider } = require("@polkadot/api");
const { ContractPromise } = require("@polkadot/api-contract");
const { Keyring } = require("@polkadot/keyring");

let api;
let contract;
let signer;

async function init() {
    api = await ApiPromise.create({
        provider: new WsProvider(process.env.WS_PROVIDER)
    });

    const metadata = JSON.parse(
        fs.readFileSync(process.env.METADATA)
    );

    contract = new ContractPromise(
        api,
        metadata,
        process.env.CONTRACT
    );

    const keyring = new Keyring({
        type: "sr25519"
    });

    signer = keyring.addFromMnemonic(process.env.MNEMONIC);
}

async function increment() {

    const tx = contract.tx.increment(
        {
            gasLimit: null,
            storageDepositLimit: null
        }
    );

    return new Promise((resolve, reject) => {

        tx.signAndSend(signer, ({ status, dispatchError }) => {

            if (dispatchError) {
                reject(dispatchError.toString());
            }

            if (status.isInBlock) {
                resolve(status.asInBlock.toHex());
            }
        });

    });
}

module.exports = {
    init,
    increment
};