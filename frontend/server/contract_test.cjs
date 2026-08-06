const assert = require("node:assert/strict");
const path = require("path");
const c = require("./contract.cjs");

if (typeof process.loadEnvFile === "function") {
    try {
        process.loadEnvFile(path.resolve(__dirname, "../../.env"));
    } catch (error) {
        if (error?.code !== "ENOENT") {
            throw error;
        }
    }
}

const test = async () => {
    try {
        await c.init();
        const arbitrator = await c.getSignerAddress();
        const provider = "0x2222222222222222222222222222222222222222";

        const deployment = await c.createEscrow(provider, arbitrator, 100);
        console.log("Deployed escrow:", deployment);

        const pendingState = await c.getState();
        assert.equal(pendingState, "PendingWork", "new escrow should start in PendingWork");
        console.log("Initial state:", pendingState);

        const blockHash = await c.completeWork();
        console.log("complete_work tx:", blockHash);

        const awaitingState = await c.getState();
        assert.equal(awaitingState, "AwaitingApproval", "complete_work should move escrow to AwaitingApproval");
        console.log("State after complete_work:", awaitingState);

        console.log("complete_work test passed");
    } finally {
        await c.disconnect();
    }
};

test().catch((error) => {
    console.error(error);
    process.exit(1);
});
