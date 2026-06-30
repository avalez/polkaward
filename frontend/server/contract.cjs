const fs = require("fs");
const path = require("path");

const { ApiPromise, WsProvider } = require("@polkadot/api");
const { ContractPromise } = require("@polkadot/api-contract");
const { Keyring } = require("@polkadot/keyring");

const projectRoot = path.resolve(__dirname, "../..");

let api;
let contract;
let signer;

function resolveProjectPath(filePath) {
    if (!filePath) {
        return filePath;
    }

    return path.isAbsolute(filePath) ? filePath : path.resolve(projectRoot, filePath);
}

function requireEnv(name) {
    const value = process.env[name];

    if (!value) {
        throw new Error(`Missing required environment variable ${name}. Copy env.sample to .env and set ${name}.`);
    }

    return value;
}

function formatDispatchError(dispatchError) {
    if (dispatchError.isModule) {
        const decoded = api.registry.findMetaError(dispatchError.asModule);
        return `${decoded.section}.${decoded.name}: ${decoded.docs.join(" ")}`;
    }

    return dispatchError.toString();
}

function isDispatchError(dispatchError, section, name) {
    if (!dispatchError.isModule) {
        return false;
    }

    const decoded = api.registry.findMetaError(dispatchError.asModule);
    return decoded.section === section && decoded.name === name;
}

function getQueryGasLimit() {
    const maxExtrinsic = api.consts.system.blockWeights.perClass.normal.maxExtrinsic;
    const maxBlock = api.consts.system.blockWeights.maxBlock;
    const maxWeight = maxExtrinsic.isSome ? maxExtrinsic.unwrap() : maxBlock;

    return api.registry.createType("Weight", {
        refTime: maxWeight.refTime,
        proofSize: maxWeight.proofSize
    });
}

async function signAndSend(tx) {
    return new Promise((resolve, reject) => {
        let unsubscribe;

        tx.signAndSend(signer, (result) => {
            const { status, dispatchError } = result;

            if (dispatchError) {
                if (unsubscribe) {
                    unsubscribe();
                }

                reject(new Error(formatDispatchError(dispatchError)));
                return;
            }

            if (status.isInBlock) {
                if (unsubscribe) {
                    unsubscribe();
                }

                resolve(status.asInBlock.toHex());
            }
        }).then((unsub) => {
            unsubscribe = unsub;
        }).catch(reject);
    });
}

async function init() {
    const wsProvider = requireEnv("WS_PROVIDER");
    const metadataFile = requireEnv("METADATA");
    const contractAddress = requireEnv("CONTRACT");
    const mnemonic = requireEnv("MNEMONIC");

    api = await ApiPromise.create({
        provider: new WsProvider(wsProvider)
    });

    const metadataPath = resolveProjectPath(metadataFile);
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));

    contract = new ContractPromise(
        api,
        metadata,
        contractAddress
    );

    const keyring = new Keyring({
        type: "sr25519"
    });

    signer = keyring.addFromUri(mnemonic);
}

async function increment() {
    let { gasRequired, result } = await contract.query.inc(
        signer.address,
        {
            gasLimit: getQueryGasLimit()
        },
        1
    );

    if (result.isErr && isDispatchError(result.asErr, "revive", "AccountUnmapped")) {
        await signAndSend(api.tx.revive.mapAccount());

        ({ gasRequired, result } = await contract.query.inc(
            signer.address,
            {
                gasLimit: getQueryGasLimit()
            },
            1
        ));
    }

    if (result.isErr) {
        throw new Error(formatDispatchError(result.asErr));
    }

    const tx = contract.tx.inc(
        {
            gasLimit: gasRequired
        },
        1
    );

    return signAndSend(tx);
}

async function disconnect() {
    if (api) {
        await api.disconnect();
    }
}

module.exports = {
    init,
    increment,
    disconnect
};
