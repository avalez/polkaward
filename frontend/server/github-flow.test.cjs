const test = require("node:test");
const assert = require("node:assert/strict");
const c = require("./contract.cjs");

const { createGitHubFlowStore } = require("./github-flow.cjs");

test("stores repo wallet mappings and work signals", async (t) => {
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
  assert.equal(state, "Funded", "new escrow should start in Funded");

  store.setRepoWalletMapping("octo/demo", arbitrator, provider, deployment.contractAddress);
  await store.setWorkSignal("octo/demo");
  state = await c.getState();
  assert.equal(state, "Funded", "complete_work should keep the escrow in Funded");

  const releaseTx = await c.releasePayment();
  console.log("release_payment tx:", releaseTx);
  state = await c.getState();
  assert.equal(state, "Completed", "release_payment should settle the escrow as Completed");

  const workSignals = await store.getWorkSignals();
  console.log(workSignals);
  assert.equal(workSignals.length, 1);
});
