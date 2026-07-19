const fs = require("fs");
const path = require("path");

const { ApiPromise, WsProvider } = require("@polkadot/api");
const { ContractPromise } = require("@polkadot/api-contract");
const { Keyring } = require("@polkadot/keyring");

const projectRoot = path.resolve(__dirname, "../..");

let api;
let contract;
let contractMetadata;
let signer;
let signerAddress;

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

    const candidates = [];
    const direct = output;

    if (typeof direct.toHuman === "function") {
        candidates.push(direct.toHuman());
    }

    if (typeof direct.toJSON === "function") {
        candidates.push(direct.toJSON());
    }

    candidates.push(direct);

    for (const candidate of candidates) {
        if (typeof candidate === "string") {
            return candidate;
        }

        if (typeof candidate === "number" || typeof candidate === "boolean") {
            return String(candidate);
        }

        if (candidate && typeof candidate === "object") {
            const values = [candidate.ok, candidate.Ok, candidate.value, candidate.Value, candidate.result, candidate.Result];

            for (const value of values) {
                if (typeof value === "string") {
                    return value;
                }

                if (value && typeof value === "object") {
                    const nestedValues = [value.ok, value.Ok, value.value, value.Value];

                    for (const nestedValue of nestedValues) {
                        if (typeof nestedValue === "string") {
                            return nestedValue;
                        }
                    }

                    if (typeof value === "object") {
                        const keys = Object.keys(value);
                        if (keys.length === 1) {
                            const [firstKey] = keys;
                            const nested = value[firstKey];
                            if (typeof nested === "string") {
                                return nested;
                            }
                        }
                    }
                }
            }

            const keys = Object.keys(candidate);
            if (keys.length === 1) {
                const [firstKey] = keys;
                const nested = candidate[firstKey];
                if (typeof nested === "string") {
                    return nested;
                }
            }
        }
    }

    return "Unknown";
}

function findContractError(value) {
    if (!value || typeof value !== "object") {
        return null;
    }

    for (const [key, nested] of Object.entries(value)) {
        if (key.toLowerCase() === "err") {
            return typeof nested === "string" ? nested : JSON.stringify(nested);
        }

        const found = findContractError(nested);
        if (found) {
            return found;
        }
    }

    return null;
}

function resolveContractMethod(methodName, kind) {
    if (!contract || !contract[kind] || typeof contract[kind] !== "object") {
        return null;
    }

    if (typeof contract[kind][methodName] === "function") {
        return contract[kind][methodName];
    }

    const candidates = [];
    const camelCase = methodName.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
    const snakeCase = methodName.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

    if (camelCase !== methodName) {
        candidates.push(camelCase);
    }

    if (snakeCase !== methodName) {
        candidates.push(snakeCase);
    }

    for (const candidate of candidates) {
        if (typeof contract[kind][candidate] === "function") {
            return contract[kind][candidate];
        }
    }

    return null;
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

    contractMetadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));

    contract = new ContractPromise(
        api,
        contractMetadata,
        contractAddress
    );

    const keyring = new Keyring({
        type: "sr25519"
    });

    signer = keyring.addFromUri(mnemonic);

    console.log(`Substrate Address: ${signer.address}`);

    signerAddress = (await api.call.reviveApi.address(signer.address)).toString();
    const originalAccount = await api.query.revive.originalAccount(signerAddress);

    if (originalAccount.isNone) {
        console.log("Sending mapping transaction... (A small SOL/DOT rent deposit will be reserved)");

        await signAndSend(api.tx.revive.mapAccount());
        signerAddress = (await api.call.reviveApi.address(signer.address)).toString();
    }
}

function setContractAddress(contractAddress) {
    if (!api || !contractMetadata) {
        throw new Error("Contract service is not initialized");
    }

    contract = new ContractPromise(api, contractMetadata, contractAddress);
}

async function queryMessage(methodName, args = [], options = {}) {
    const queryMethod = resolveContractMethod(methodName, "query");

    if (!queryMethod) {
        throw new Error(`Unsupported contract query method: ${methodName}`);
    }

    const queryOptions = {
        gasLimit: getQueryGasLimit(),
        ...options
    };

    let response = await queryMethod(signer.address, queryOptions, ...args);
    let { gasRequired, result, output } = response;

    if (result.isErr && isDispatchError(result.asErr, "revive", "AccountUnmapped")) {
        await signAndSend(api.tx.revive.mapAccount());

        response = await queryMethod(signer.address, queryOptions, ...args);
        ({ gasRequired, result, output } = response);
    }

    if (result.isErr) {
        throw new Error(formatDispatchError(result.asErr));
    }

    const contractError = findContractError(output?.toJSON?.() ?? output);
    if (contractError) {
        throw new Error(`Contract returned an error: ${contractError}`);
    }

    return { gasRequired, result, output };
}

async function getSignerAddress() {
    return signerAddress;
}

async function sendMessage(methodName, args = [], options = {}) {
    const txMethod = resolveContractMethod(methodName, "tx");

    if (!txMethod) {
        throw new Error(`Unsupported contract transaction method: ${methodName}`);
    }

    let gasRequired = getQueryGasLimit();

    const queryMethod = resolveContractMethod(methodName, "query");
    if (queryMethod) {
        ({ gasRequired } = await queryMessage(methodName, args, options));
    }

    const tx = txMethod(
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

async function completeWork() {
    return sendMessage("complete_work");
}

async function refundClient() {
    return sendMessage("refund_client");
}

async function raiseDispute() {
    return sendMessage("raise_dispute");
}

async function getState() {
    const { output } = await queryMessage("get_state");
    return normalizeContractOutput(output);
}

async function increment() {
    return completeWork();
}

async function disconnect() {
    if (api) {
        await api.disconnect();
    }
}

module.exports = {
    init,
    setContractAddress,
    getSignerAddress,
    createEscrow,
    completeWork,
    releasePayment,
    refundClient,
    raiseDispute,
    getState,
    increment,
    disconnect
};
