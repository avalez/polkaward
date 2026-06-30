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
npm run server
```

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
