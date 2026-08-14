const contract = require("./contract.cjs");

function createGitHubFlowStore() {
  const repoWalletMappings = new Map();
  const repoWorkSignals = new Map();

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

    async setWorkSignal(repo) {
      const mapping = repoWalletMappings.get(repo);
      if (mapping?.contractAddress) {
        contract.setContractAddress(mapping.contractAddress, mapping.walletAddress);
      }

      repoWorkSignals.set(repo, { status: "triggered" });
      return await contract.completeWork();
    },

    async getWorkSignal(repo) {
      const mapping = repoWalletMappings.get(repo);
      if (mapping?.contractAddress) {
        contract.setContractAddress(mapping.contractAddress, mapping.walletAddress);
        return await contract.getState();
      }
      return null;
    },

    async getWorkSignals() {
      const results = [];
      for (const [repo, workSignal] of repoWorkSignals.entries()) {
        const mapping = repoWalletMappings.get(repo);
        if (mapping?.contractAddress) {
          contract.setContractAddress(mapping.contractAddress, mapping.walletAddress);
          const state = await contract.getState();
          results.push({ repo, ...workSignal, state });
        } else {
          results.push({ repo, ...workSignal });
        }
      }
      return results;
    },

    clearWorkSignal(repo) {
      repoWorkSignals.delete(repo);
    }
  };
}

module.exports = {
  createGitHubFlowStore
};
