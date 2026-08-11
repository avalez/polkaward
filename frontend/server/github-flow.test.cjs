const test = require("node:test");
const assert = require("node:assert/strict");

const { createGitHubFlowStore } = require("./github-flow.cjs");

test("stores repo wallet mappings and awaiting approvals", async () => {
  const store = createGitHubFlowStore();

  store.setRepoWalletMapping("octo/demo", "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY", "installation-42");
  store.setAwaitingApproval("octo/demo");

  assert.equal(store.getRepoWalletMapping("octo/demo")?.walletAddress, "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY");
  const state = await store.getAwaitingApproval("octo/demo");
  assert.equal(state, "awaiting");
  //assert.equal(store.getAwaitingApprovals().length, 1);
});
