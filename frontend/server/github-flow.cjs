const contract = require("./contract.cjs");

function createGitHubFlowStore() {
  const repoWalletMappings = new Map();
  const awaitingApprovals = new Map();

  return {
    setRepoWalletMapping(repo, walletAddress, installationId, contractAddress) {
      repoWalletMappings.set(repo, { walletAddress, installationId, contractAddress });
      if (contractAddress) {
        contract.setContractAddress(contractAddress, walletAddress);
      }
    },

    getRepoWalletMapping(repo) {
      return repoWalletMappings.get(repo) ?? null;
    },

    async setAwaitingApproval(repo) {
      const mapping = repoWalletMappings.get(repo);
      if (mapping?.contractAddress) {
        contract.setContractAddress(mapping.contractAddress, mapping.walletAddress);
      }

      awaitingApprovals.set(repo, { status: "awaiting" });
      return await contract.completeWork();
    },

    async getAwaitingApproval(repo) {
      const mapping = repoWalletMappings.get(repo);
      if (mapping?.contractAddress) {
        contract.setContractAddress(mapping.contractAddress, mapping.walletAddress);
        return await contract.getState();
      }
      return null;
    },

    async getAwaitingApprovals() {
      const results = [];
      for (const [repo, approval] of awaitingApprovals.entries()) {
        const mapping = repoWalletMappings.get(repo);
        if (mapping?.contractAddress) {
          contract.setContractAddress(mapping.contractAddress, mapping.walletAddress);
          const state = await contract.getState();
          results.push({ repo, ...approval, state });
        } else {
          results.push({ repo, ...approval });
        }
      }
      return results;
    },

    clearAwaitingApproval(repo) {
      awaitingApprovals.delete(repo);
    }
  };
}

module.exports = {
  createGitHubFlowStore
};
