const test = require("node:test");
const assert = require("node:assert/strict");

const { createGitHubFlowStore } = require("./github-flow.cjs");

test("stores repo wallet mappings and pending approvals", () => {
  const store = createGitHubFlowStore();

  store.setRepoWalletMapping("octo/demo", "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY", "installation-42");
  store.setPendingApproval("octo/demo", {
    action: "complete_work",
    status: "pending"
  });

  assert.equal(store.getRepoWalletMapping("octo/demo")?.walletAddress, "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY");
  assert.equal(store.getPendingApproval("octo/demo")?.action, "complete_work");
  assert.equal(store.getPendingApprovals().length, 1);
});
