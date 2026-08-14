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
        assert.equal(pendingState, "Funded", "new escrow should start in Funded");
        console.log("Initial state:", pendingState);

        const blockHash = await c.completeWork();
        console.log("complete_work tx:", blockHash);

        const stateAfterCompletion = await c.getState();
        assert.equal(stateAfterCompletion, "Funded", "complete_work should leave the escrow in Funded");
        console.log("State after complete_work:", stateAfterCompletion);

        const releaseTx = await c.releasePayment();
        console.log("release_payment tx:", releaseTx);

        const finalState = await c.getState();
        assert.equal(finalState, "Completed", "release_payment should settle the escrow as Completed");
        console.log("State after release_payment:", finalState);

        console.log("complete_work and release_payment test passed");
    } finally {
        await c.disconnect();
    }
};

test().catch((error) => {
    console.error(error);
    process.exit(1);
});
