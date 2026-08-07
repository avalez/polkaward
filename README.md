# polkaward

Contribution rewards on Polkadot.

## Project layout

- `src/` contains the ink! smart contract.
- `frontend/` contains the Vite frontend.

## Root commands

```sh
npm run build
```

Builds both the contract and the frontend from the project root.

```sh
npm run contract:build
npm run frontend:build
npm run dev
```

Open http://localhost:5173/ in your browser.

Click **Create Escrow**.

**!!Update the contract address in .env!!**

Call GitHub WebHook manually `curl -X POST http://localhost:3000/webhook -H "Content-Type: application/json" -d "{\"action\": \"opened\", \"issue\": {\"number\": 1}}"`

Or for real world example:

Configure ngrok to expose the server to the internet, for example: `ngrok http 3000`

Configure **Git Hub WebHook** at https://github.com/hironobu/polkaward/settings/hooks.

Initiate GitHub WebHook by pushing code to the repository.

Click **complete_work**.

Expect AwaitingApproval status in frontend.

Alternative for testing directly without webhooks (for contract development) w. Polkadot.js Apps.

```sh
pop up paseo -p passet-hub:9944

cargo contract upload \
    --url ws://localhost:9944 \
    --suri //Alice \
    --execute

cargo contract instantiate \
    --url ws://localhost:9944 \
    --suri //Alice \
    --constructor new \
    --args 0 \
    --execute

# you get contract address and save it in .env file as CONTRACT_ADDRESS

cargo contract call \
    --url ws://localhost:9944 \
    --suri //Alice \
    --contract $CONTRACT_ADDRESS \
    --message inc \
    --execute \
    --args 1

cargo contract call \
    --url ws://localhost:9944 \
    --suri //Alice \
    --contract $CONTRACT_ADDRESS \
    --message get

npm --prefix frontend run contract:test
```

Use these for contract-only builds, frontend-only builds, and frontend
development. `npm run server` starts the CommonJS Express webhook server from
the Vite app folder and serves the built frontend from `frontend/dist/`.
