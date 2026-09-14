const { ApiPromise, WsProvider } = require("@polkadot/api");

async function run() {
  const api = await ApiPromise.create({ provider: new WsProvider("ws://127.0.0.1:9944"), noInitWarn: true });
  const errorObj = api.registry.createType('DispatchError', { module: { index: 60, error: '0x2b000000' } });
  const decoded = api.registry.findMetaError(errorObj.asModule);
  console.log(`Error: ${decoded.section}.${decoded.name} - ${decoded.docs.join(" ")}`);
  process.exit(0);
}
run();
