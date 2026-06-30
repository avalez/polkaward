import { useState } from 'react';
import {
  useCallSubscription,
  useContract,
  useInstalledWallets,
  useTx,
  useWallet,
} from 'useink';
import { useTxNotifications } from 'useink/notifications';
import { pickDecoded, shouldDisable } from 'useink/utils';
import metadata from './assets/incrementer.json';
import { CONTRACT_ROCOCO_ADDRESS } from './constants';

const formatContractName = (name: string) =>
  name
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

function App() {
  const { account, connect } = useWallet();
  const wallets = useInstalledWallets();
  const wallet = wallets[0];
  const contract = useContract(CONTRACT_ROCOCO_ADDRESS, metadata);
  const getSub = useCallSubscription<number>(contract, 'get', [], {
    defaultCaller: true,
  });
  const [incAmount, setIncAmount] = useState(1);
  const inc = useTx(contract, 'inc');
  useTxNotifications(inc);

  return (
    <main className='min-h-screen bg-slate-950 px-4 py-8 text-slate-100 md:px-6 md:py-12'>
      <section className='mx-auto flex min-h-[calc(100vh-6rem)] w-full max-w-md flex-col justify-center'>
        <div className='rounded-lg border border-slate-800 bg-slate-900 p-6 shadow-xl shadow-black/20'>
          <h1 className='text-2xl font-bold'>
          {formatContractName(metadata.contract.name)}
          </h1>

          <p className='my-6 text-slate-300'>
            Current Number:{' '}
            <b className='uppercase text-slate-50'>{pickDecoded(getSub.result)}</b>
          </p>

          <input
            className='h-11 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-base text-slate-100 outline-none transition focus:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-60'
            disabled={shouldDisable(inc)}
            max={100}
            min={1}
            onChange={(event) => setIncAmount(event.currentTarget.valueAsNumber)}
            type='number'
            value={incAmount}
          />

          {account ? (
            <button
              className='mt-6 h-11 w-full rounded-md bg-cyan-400 px-4 font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400'
              disabled={shouldDisable(inc)}
              onClick={() => inc.signAndSend([incAmount])}
              type='button'
            >
              {shouldDisable(inc)
                ? 'Incrementing...'
                : `Increment by ${incAmount}`}
            </button>
          ) : (
            <button
              className='mt-6 h-11 w-full rounded-md bg-cyan-400 px-4 font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400'
              disabled={!wallet}
              onClick={() => wallet && connect(wallet.extensionName)}
              type='button'
            >
              {wallet ? `Connect ${wallet.title}` : 'Install a Polkadot wallet'}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

export default App;
