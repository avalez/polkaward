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
  let currentState = await c.getState();
  assert.equal(currentState, "Funded", "escrow should be Funded after work signal");

  const releaseTx = await c.releasePayment();
  console.log("release_payment tx:", releaseTx);
  currentState = await c.getState();
  assert.equal(currentState, "Released", "release_payment should settle as Released");

  const workSignals = await store.getWorkSignals();
  console.log(workSignals);
  assert.equal(workSignals.length, 1);
});
