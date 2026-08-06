const fs = require("fs");
const path = require("path");

const { ApiPromise, WsProvider } = require("@polkadot/api");
const { Keyring } = require("@polkadot/keyring");
const { Abi } = require('@polkadot/api-contract');

const projectRoot = path.resolve(__dirname, "../..");

let api;
let contractAddress;
let arbitratorAddress;
let contractMetadata;
let abi;
let signer;
let signerAddress;

function resolveProjectPath(filePath) {
    return path.isAbsolute(filePath) ? filePath : path.resolve(projectRoot, filePath);
}

function requireEnv(name, fallbackValue) {
    const value = process.env[name] || fallbackValue;
    if (!value) throw new Error(`Missing required environment variable ${name}`);
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
    if (!dispatchError.isModule) return false;
    const decoded = api.registry.findMetaError(dispatchError.asModule);
    return decoded.section === section && decoded.name === name;
}

// SCALE encodes a u64 into 8 bytes little-endian hex
function encodeU64(value) {
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64LE(BigInt(value));
    return buffer.toString('hex');
}

// Ensure address is 20-bytes (H160) for SCALE encoding in pallet-revive
function encodeAccountId(address) {
    return address.startsWith('0x') ? address.slice(2) : address;
}

async function signAndSend(tx, options = { extractAddress: false, waitForFinalized: false }) {
    return new Promise((resolve, reject) => {
        let unsubscribe;
        tx.signAndSend(signer, (result) => {
            const { status, dispatchError, events } = result;

            if (dispatchError) {
                if (unsubscribe) unsubscribe();
                return reject(new Error(formatDispatchError(dispatchError)));
            }

            const isDone = options.waitForFinalized ? status.isFinalized : status.isInBlock;

            if (isDone) {
                if (unsubscribe) unsubscribe();
                const blockHash = status.isInBlock ? status.asInBlock.toHex() : status.asFinalized.toHex();

                if (options.extractAddress) {
                    let addr = null;
                    for (const { event } of events) {
                        const isInstantiated =
                            (event.section === 'revive' && event.method === 'Instantiated') ||
                            (event.section === 'contracts' && event.method === 'Instantiated');
                        if (isInstantiated) {
                            addr = event.data[1].toString(); // [deployer, contract]
                            break;
                        }
                    }
                    return resolve({ blockHash, contractAddress: addr });
                }
                resolve(blockHash);
            }
        }).then(unsub => unsubscribe = unsub).catch(reject);
    });
}

async function init() {
    const wsProvider = requireEnv("WS_PROVIDER", "ws://127.0.0.1:9944");
    const metadataFile = requireEnv("METADATA", "target/ink/polkaward.contract");
    contractAddress = requireEnv("CONTRACT", "0x48550a4bb374727186c55365b7c9c0a1a31bdafe");
    const mnemonic = requireEnv("MNEMONIC", "//Alice");

    api = await ApiPromise.create({
        provider: new WsProvider(wsProvider),
        noInitWarn: true
    });

    const metadataPath = resolveProjectPath(metadataFile);
    if (!fs.existsSync(metadataPath)) {
        throw new Error(`Contract metadata file not found: ${metadataPath}`);
    }

    contractMetadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    abi = new Abi(contractMetadata);

    const keyring = new Keyring({ type: "sr25519" });
    signer = keyring.addFromUri(mnemonic);

    console.log(`Substrate Address: ${signer.address}`);

    signerAddress = (await api.call.reviveApi.address(signer.address)).toString();
    console.log(`Signer Address: ${signerAddress}`);
    const originalAccount = await api.query.revive.originalAccount(signerAddress);

    if (originalAccount.isNone) {
        console.log("Sending mapping transaction...");
        await signAndSend(api.tx.revive.mapAccount());
        signerAddress = (await api.call.reviveApi.address(signer.address)).toString();
    }
}

function setContractAddress(address, arbitrator) {
    contractAddress = address;
    arbitratorAddress = arbitrator;
}

async function queryMessage(methodName, args = [], options = {}) {
    const message = abi.messages.find(m => m.identifier === methodName);
    if (!message) throw new Error(`Unsupported method: ${methodName}`);

    const selectorHex = message.selector.toHex().slice(2);
    let argsHex = "";
    // Note: this simple packing works for AccountId and u64 if args map strictly
    // For a robust implementation, use `abi` message toU8a if it supports raw H160 correctly
    for (const arg of args) {
        if (typeof arg === 'string' && arg.startsWith('0x')) {
            argsHex += encodeAccountId(arg);
        } else if (typeof arg === 'number' || typeof arg === 'bigint') {
            argsHex += encodeU64(arg);
        }
    }

    const inputData = `0x${selectorHex}${argsHex}`;

    const dryRunResult = await api.call.reviveApi.call(
        signer.address,
        contractAddress,
        0, // value
        null, // weight limit
        null, // storage limit
        inputData
    );

    const flags = dryRunResult.result.asOk.get('flags').get('bits').toNumber();
    if ((flags & 1) !== 0) {
        const rawData = dryRunResult.result.asOk.data.toHex();
        let decodedErr = rawData;
        try {
            const returnType = message.returnType && message.returnType.type;
            if (returnType) {
                const decoded = abi.registry.createTypeUnsafe(returnType, [rawData]);
                decodedErr = JSON.stringify(decoded.toHuman());
            }
        } catch(e) {}
        throw new Error(`Contract Reverted: ${decodedErr}`);
    }

    return {
        gasRequired: dryRunResult.weightRequired,
        storageDeposit: dryRunResult.storageDeposit,
        output: dryRunResult.result.asOk.data
    };
}

async function sendMessage(methodName, args = [], options = {}) {
    const { gasRequired, storageDeposit } = await queryMessage(methodName, args, options);
    const message = abi.messages.find(m => m.identifier === methodName);
    const selectorHex = message.selector.toHex().slice(2);
    let argsHex = "";

    for (const arg of args) {
        if (typeof arg === 'string' && arg.startsWith('0x')) {
            argsHex += encodeAccountId(arg);
        } else if (typeof arg === 'number' || typeof arg === 'bigint') {
            argsHex += encodeU64(arg);
        }
    }
    const inputData = `0x${selectorHex}${argsHex}`;

    const gasLimit = api.registry.createType("Weight", {
        refTime: (BigInt(gasRequired.refTime.toString()) * 12n) / 10n,
        proofSize: (BigInt(gasRequired.proofSize.toString()) * 12n) / 10n
    });

    const tx = api.tx.revive.call(
        contractAddress,
        0, // value
        gasLimit,
        storageDeposit.asCharge || (1n << 128n) - 1n,
        inputData
    );

    return signAndSend(tx);
}

async function createEscrow(provider, arbitrator, duration, value = "10000000000000") {
    const constructorMessage = abi.constructors.find(c => c.identifier === 'new');
    const selectorHex = constructorMessage.selector.toHex().slice(2);

    const providerHex = encodeAccountId(provider);
    const arbitratorHex = encodeAccountId(arbitrator);
    const durationHex = encodeU64(duration);

    const constructorArgs = `${selectorHex}${providerHex}${arbitratorHex}${durationHex}`;

    // Revive instantiateWithCode requires bytecode + appended constructor args
    let wasmBytecodeHex = contractMetadata.source.contract_binary || contractMetadata.source.wasm || contractMetadata.source.code;
    if (wasmBytecodeHex.startsWith('0x')) wasmBytecodeHex = wasmBytecodeHex.slice(2);
    const fullCodeBlob = `0x${wasmBytecodeHex}`;

    const crypto = require("crypto");
    const randomSalt = '0x' + crypto.randomBytes(32).toString('hex');

    // Dry-run instantiate to get gas limits
    const dryRunResult = await api.call.reviveApi.instantiate(
        signer.address,
        value,
        null, // gas
        null, // storage
        { Upload: fullCodeBlob },
        `0x${constructorArgs}`, // data
        randomSalt
    );

    if (dryRunResult.result.isErr) {
        throw new Error(`Instantiate DryRun Failed: ${dryRunResult.result.asErr.toString()}`);
    }

    const gasLimit = api.registry.createType("Weight", {
        refTime: (BigInt(dryRunResult.weightRequired.refTime.toString()) * 12n) / 10n,
        proofSize: (BigInt(dryRunResult.weightRequired.proofSize.toString()) * 12n) / 10n
    });

    const tx = api.tx.revive.instantiateWithCode(
        value,
        gasLimit,
        dryRunResult.storageDeposit.asCharge || (1n << 128n) - 1n,
        fullCodeBlob,
        `0x${constructorArgs}`,
        randomSalt
    );

    const { blockHash, contractAddress: newAddress } = await signAndSend(tx, { extractAddress: true });

    if (newAddress) {
        setContractAddress(newAddress, arbitrator);
    }

    return { blockHash, contractAddress: newAddress };
}

async function getSignerAddress() {
    return signerAddress;
}

async function releasePayment() { return sendMessage("release_payment"); }
async function completeWork() { return sendMessage("complete_work"); }
async function refundClient() { return sendMessage("refund_client"); }
async function raiseDispute() { return sendMessage("raise_dispute"); }
async function increment() { return completeWork(); }

async function getState() {
    const { output } = await queryMessage("get_state");
    // decode output against return type
    const message = abi.messages.find(m => m.identifier === 'get_state');
    if (message && message.returnType) {
        const decoded = abi.registry.createTypeUnsafe(message.returnType.type, [output.toHex()]);
        return decoded.toHuman()?.Ok || "Unknown";
    }
    return "Unknown";
}

async function disconnect() {
    if (api) await api.disconnect();
}

module.exports = {
    init, setContractAddress, getSignerAddress, createEscrow,
    completeWork, releasePayment, refundClient, raiseDispute,
    getState, increment, disconnect
};
