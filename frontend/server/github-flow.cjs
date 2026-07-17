function createGitHubFlowStore() {
  const repoWalletMappings = new Map();
  const pendingApprovals = new Map();

  return {
    setRepoWalletMapping(repo, walletAddress, installationId, contractAddress) {
      repoWalletMappings.set(repo, { walletAddress, installationId, contractAddress });
    },
    getRepoWalletMapping(repo) {
      return repoWalletMappings.get(repo) ?? null;
    },
    setPendingApproval(repo, approval) {
      pendingApprovals.set(repo, approval);
    },
    getPendingApproval(repo) {
      return pendingApprovals.get(repo) ?? null;
    },
    getPendingApprovals() {
      return Array.from(pendingApprovals.entries()).map(([repo, approval]) => ({ repo, ...approval }));
    },
    clearPendingApproval(repo) {
      pendingApprovals.delete(repo);
    }
  };
}

module.exports = {
  createGitHubFlowStore
};
