import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { PolkadotAgentKit } from '@polkadot-agent-kit/sdk';
import { getMcpTools } from '@polkadot-agent-kit/mcp';
// Import utilities to access and modify chain definitions
import { getAllSupportedChains } from '@polkadot-agent-kit/common';

async function runServer() {
  const privateKey = process.env.PRIVATE_KEY;

  if (!privateKey) {
    throw new Error('PRIVATE_KEY environment variable is required');
  }

  const agentKit = new PolkadotAgentKit({
    privateKey,
    chains: ['polkadot'/*, 'polkadot_asset_hub'*/],
  });
  // Override RPC URLs if WS_PROVIDER is defined
  const customProvider = process.env.WS_PROVIDER;
  if (customProvider) {
    const supportedChains = getAllSupportedChains();
    // Apply to the chains the agent will use
    ['polkadot', 'kusama', 'westend'].forEach((id) => {
      const chain = supportedChains.find((c) => c.id === id);
      if (chain) {
        // Ensure wsUrls is an array of strings
        chain.wsUrls = [customProvider];
      }
    });
  }

  await agentKit.initializeApi();

  const { tools, toolHandler } = await getMcpTools(agentKit);

  const server = new Server(
    {
      name: 'polkadot-agent-kit',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return await toolHandler(request.params.name, request.params.arguments);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log('Polkadot Agent Kit MCP server running on stdio');
}

runServer().catch((error) => {
  console.error(error);
  process.exit(1);
});
