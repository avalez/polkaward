const test = require("node:test");
const assert = require("node:assert/strict");
const c = require("./contract.cjs");
const path = require("path");

const { createGitHubFlowStore } = require("./github-flow.cjs");

if (typeof process.loadEnvFile === "function") {
    try {
        process.loadEnvFile(path.resolve(__dirname, "../../.env"));
    } catch (error) {
        if (error?.code !== "ENOENT") {
            throw error;
        }
    }
}

test("stores repo wallet mappings and awaiting approvals", async (t) => {
  const store = createGitHubFlowStore();
  await c.init();

  t.after(async () => {
    await c.disconnect();
  });

  const arbitrator = await c.getSignerAddress();
  const provider = "0x2222222222222222222222222222222222222222";

  const deployment = await c.createEscrow(provider, arbitrator, 100);
  console.log("Deployed escrow:", deployment);
  let state = await c.getState();
  assert.equal(state, "PendingWork", "new escrow should start in PendingWork");

  store.setRepoWalletMapping("octo/demo", arbitrator, provider, deployment.contractAddress);
  await store.setAwaitingApproval("octo/demo");
  state = await c.getState();
  assert.equal(state, "AwaitingApproval", "complete_work should move escrow to AwaitingApproval");

  const approvals = await store.getAwaitingApprovals();
  console.log(approvals);
  assert.equal(approvals.length, 1);
});
