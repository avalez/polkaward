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

function requireEnv(name, fallbackValue) {
    const value = process.env[name] || fallbackValue;

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

function normalizeContractOutput(output) {
    if (!output) {
        return "Unknown";
    }

    const human = typeof output.toHuman === "function" ? output.toHuman() : output;
    const json = typeof output.toJSON === "function" ? output.toJSON() : human;

    if (typeof json === "string") {
        return json;
    }

    if (json && typeof json === "object") {
        const outer = json;
        const ok = outer.ok ?? outer.Ok;

        if (typeof ok === "string") {
            return ok;
        }

        if (ok && typeof ok === "object") {
            return Object.keys(ok)[0] ?? "Unknown";
        }

        return Object.keys(outer)[0] ?? "Unknown";
    }

    return String(human ?? "Unknown");
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
    const wsProvider = requireEnv("WS_PROVIDER", "ws://127.0.0.1:9944");
    const metadataFile = requireEnv("METADATA", "target/ink/polkaward.contract");
    const contractAddress = requireEnv("CONTRACT", "0x48550a4bb374727186c55365b7c9c0a1a31bdafe");
    const mnemonic = requireEnv("MNEMONIC", "//Alice");

    api = await ApiPromise.create({
        provider: new WsProvider(wsProvider),
        noInitWarn: true
    });

    const metadataPath = resolveProjectPath(metadataFile);

    if (!fs.existsSync(metadataPath)) {
        throw new Error(`Contract metadata file not found: ${metadataPath}. Run cargo contract build or update METADATA in your env file.`);
    }

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

async function queryMessage(methodName, args = [], options = {}) {
    const queryOptions = {
        gasLimit: getQueryGasLimit(),
        ...options
    };

    let { gasRequired, result } = await contract.query[methodName](signer.address, queryOptions, ...args);

    if (result.isErr && isDispatchError(result.asErr, "revive", "AccountUnmapped")) {
        await signAndSend(api.tx.revive.mapAccount());

        ({ gasRequired, result } = await contract.query[methodName](signer.address, queryOptions, ...args));
    }

    if (result.isErr) {
        throw new Error(formatDispatchError(result.asErr));
    }

    return { gasRequired, result };
}

async function sendMessage(methodName, args = [], options = {}) {
    const { gasRequired } = await queryMessage(methodName, args, options);
    const tx = contract.tx[methodName](
        {
            gasLimit: gasRequired,
            ...options
        },
        ...args
    );

    return signAndSend(tx);
}

async function createEscrow(provider, arbitrator, duration, value) {
    return sendMessage("new", [provider, arbitrator, duration], {
        value
    });
}

async function releasePayment() {
    return sendMessage("release_payment");
}

async function refundClient() {
    return sendMessage("refund_client");
}

async function raiseDispute() {
    return sendMessage("raise_dispute");
}

async function getState() {
    const { result } = await queryMessage("get_state");
    return normalizeContractOutput(result.output);
}

async function increment() {
    return getState();
}

async function disconnect() {
    if (api) {
        await api.disconnect();
    }
}

module.exports = {
    init,
    createEscrow,
    releasePayment,
    refundClient,
    raiseDispute,
    getState,
    increment,
    disconnect
};
