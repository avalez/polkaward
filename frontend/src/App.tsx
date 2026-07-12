import { useMemo, useState, type FormEvent } from 'react';
import {
  useCallSubscription,
  useChainDecimals,
  useDeployer,
  useContract,
  useInstalledWallets,
  useMetadata,
  useTokenSymbol,
  useTx,
  useWallet,
} from 'useink';
import { useTxNotifications } from 'useink/notifications';
import { pickDecoded, shouldDisable } from 'useink/utils';
import contractMetadata from './assets/polkaward.contract.json';
import metadata from './assets/polkaward.json';
import { CONTRACT_ROCOCO_ADDRESS } from './constants';

const formatContractName = (name: string) =>
  name
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const parseTokenAmount = (amount: string, decimals: number) => {
  const trimmed = amount.trim();

  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error('Enter a valid deposit amount.');
  }

  const [whole, fraction = ''] = trimmed.split('.');

  if (fraction.length > decimals) {
    throw new Error(`Deposit supports up to ${decimals} decimal places.`);
  }

  const unit = 10n ** BigInt(decimals);
  const wholeUnits = BigInt(whole) * unit;
  const fractionUnits = BigInt(fraction.padEnd(decimals, '0') || '0');
  const value = wholeUnits + fractionUnits;

  if (value === 0n) {
    throw new Error('Deposit must be greater than zero.');
  }

  return value.toString();
};

function App() {
  const { account, connect } = useWallet();
  const wallets = useInstalledWallets();
  const wallet = wallets[0];
  const deployer = useDeployer();
  const deployMetadata = useMetadata({ requireWasm: true }, contractMetadata);
  const chainDecimals = useChainDecimals();
  const tokenSymbol = useTokenSymbol();
  const decimals = chainDecimals ?? 12;
  const activeContractAddress =
    deployer.contractAddress ?? CONTRACT_ROCOCO_ADDRESS;
  const contract = useContract(activeContractAddress, metadata);
  const [provider, setProvider] = useState('');
  const [arbitrator, setArbitrator] = useState('');
  const [duration, setDuration] = useState('100');
  const [deposit, setDeposit] = useState('1');
  const [formError, setFormError] = useState('');

  const getStateSub = useCallSubscription(contract, 'get_state', [], {
    defaultCaller: true,
  });
  useTxNotifications(deployer);

  const releasePaymentTx = useTx(contract, 'release_payment');
  useTxNotifications(releasePaymentTx);

  const refundClientTx = useTx(contract, 'refund_client');
  useTxNotifications(refundClientTx);

  const raiseDisputeTx = useTx(contract, 'raise_dispute');
  useTxNotifications(raiseDisputeTx);

  // Parse the EscrowState which can come out as a string or an object like { AwaitingApproval: null }
  const stateObj = pickDecoded(getStateSub.result);
  const stateStr =
    typeof stateObj === 'string'
      ? stateObj
      : stateObj
        ? Object.keys(stateObj as Record<string, unknown>)[0]
        : 'Unknown';
  const isTerminalState = stateStr === 'Completed' || stateStr === 'Refunded';
  const isCreatingEscrow =
    deployer.isSubmitting || deployer.status === 'PendingSignature';
  const createButtonLabel = isCreatingEscrow
    ? 'Creating...'
    : 'Create Funded Escrow';
  const deploymentError = formError || deployer.error || deployMetadata.error;
  const formattedActiveAddress = useMemo(
    () =>
      activeContractAddress.length > 16
        ? `${activeContractAddress.slice(0, 8)}...${activeContractAddress.slice(
            -8,
          )}`
        : activeContractAddress,
    [activeContractAddress],
  );

  const createEscrow = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');

    if (!deployMetadata.abi) {
      setFormError('Contract metadata is not ready yet.');
      return;
    }

    const durationBlocks = Number(duration);

    if (!Number.isSafeInteger(durationBlocks) || durationBlocks <= 0) {
      setFormError('Duration must be a positive whole number of blocks.');
      return;
    }

    let value: string;

    try {
      value = parseTokenAmount(deposit, decimals);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Invalid deposit.');
      return;
    }

    deployer.signAndSend(
      deployMetadata.abi,
      'new',
      {
        provider: provider.trim(),
        arbitrator: arbitrator.trim(),
        duration: durationBlocks,
      },
      { value },
    );
  };

  return (
    <main className='min-h-screen bg-slate-950 px-4 py-8 text-slate-100 md:px-6 md:py-12'>
      <section className='mx-auto flex min-h-[calc(100vh-6rem)] w-full max-w-2xl flex-col justify-center'>
        <div className='rounded-lg border border-slate-800 bg-slate-900 p-6 shadow-xl shadow-black/20'>
          <h1 className='text-2xl font-bold'>
            {formatContractName(metadata.contract.name)}
          </h1>

          <div className='my-6 border-y border-slate-800 py-4'>
            <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
              <div>
                <span className='text-sm text-slate-400'>Active Escrow</span>
                <p className='mt-1 break-all font-mono text-sm text-slate-200'>
                  {formattedActiveAddress}
                </p>
              </div>
              <div className='flex flex-col items-start sm:items-end'>
                <span className='mb-1 text-sm text-slate-400'>Escrow State</span>
                <span
                  className={`rounded-full px-3 py-1 text-sm font-semibold ${
                    stateStr === 'AwaitingApproval'
                      ? 'bg-amber-500/20 text-amber-300'
                      : stateStr === 'Completed'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : stateStr === 'Disputed'
                          ? 'bg-rose-500/20 text-rose-300'
                          : stateStr === 'Refunded'
                            ? 'bg-slate-500/20 text-slate-300'
                            : 'bg-slate-700 text-slate-300'
                  }`}
                >
                  {stateStr || 'Loading...'}
                </span>
              </div>
            </div>
          </div>

          {account ? (
            <div className='mt-6 flex flex-col gap-6'>
              <form
                className='grid gap-4'
                onSubmit={createEscrow}
              >
                <div className='grid gap-4 sm:grid-cols-2'>
                  <label className='grid gap-2 text-sm font-medium text-slate-300'>
                    Provider H160 Address
                    <input
                      className='h-11 w-full rounded-md border border-slate-700 bg-slate-950 px-3 font-mono text-sm text-slate-100 outline-none transition focus:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-60'
                      onChange={(event) =>
                        setProvider(event.currentTarget.value)
                      }
                      placeholder='0x...'
                      required
                      type='text'
                      value={provider}
                    />
                  </label>

                  <label className='grid gap-2 text-sm font-medium text-slate-300'>
                    Arbitrator H160 Address
                    <input
                      className='h-11 w-full rounded-md border border-slate-700 bg-slate-950 px-3 font-mono text-sm text-slate-100 outline-none transition focus:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-60'
                      onChange={(event) =>
                        setArbitrator(event.currentTarget.value)
                      }
                      placeholder='0x...'
                      required
                      type='text'
                      value={arbitrator}
                    />
                  </label>

                  <label className='grid gap-2 text-sm font-medium text-slate-300'>
                    Duration Blocks
                    <input
                      className='h-11 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-base text-slate-100 outline-none transition focus:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-60'
                      min={1}
                      onChange={(event) => setDuration(event.currentTarget.value)}
                      required
                      step={1}
                      type='number'
                      value={duration}
                    />
                  </label>

                  <label className='grid gap-2 text-sm font-medium text-slate-300'>
                    Deposit {tokenSymbol ? `(${tokenSymbol})` : ''}
                    <input
                      className='h-11 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-base text-slate-100 outline-none transition focus:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-60'
                      min='0'
                      onChange={(event) => setDeposit(event.currentTarget.value)}
                      required
                      step='any'
                      type='number'
                      value={deposit}
                    />
                  </label>
                </div>

                {deploymentError ? (
                  <p className='rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200'>
                    {deploymentError}
                  </p>
                ) : null}

                {deployer.contractAddress ? (
                  <p className='rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200'>
                    Created escrow {deployer.contractAddress}
                  </p>
                ) : null}

                <button
                  className='h-11 w-full rounded-md bg-cyan-400 px-4 font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400'
                  disabled={isCreatingEscrow || Boolean(deployMetadata.error)}
                  type='submit'
                >
                  {createButtonLabel}
                </button>
              </form>

              <div className='flex flex-col gap-3'>
                <button
                  className='h-11 w-full rounded-md bg-emerald-500 px-4 font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400'
                  disabled={shouldDisable(releasePaymentTx) || isTerminalState}
                  onClick={() => releasePaymentTx.signAndSend([])}
                  type='button'
                >
                  {shouldDisable(releasePaymentTx)
                    ? 'Processing...'
                    : 'Release Payment'}
                </button>

                <button
                  className='h-11 w-full rounded-md bg-cyan-500 px-4 font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400'
                  disabled={shouldDisable(refundClientTx) || isTerminalState}
                  onClick={() => refundClientTx.signAndSend([])}
                  type='button'
                >
                  {shouldDisable(refundClientTx)
                    ? 'Processing...'
                    : 'Refund Client'}
                </button>

                <button
                  className='h-11 w-full rounded-md bg-rose-500 px-4 font-semibold text-slate-950 transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400'
                  disabled={
                    shouldDisable(raiseDisputeTx) ||
                    stateStr !== 'AwaitingApproval'
                  }
                  onClick={() => raiseDisputeTx.signAndSend([])}
                  type='button'
                >
                  {shouldDisable(raiseDisputeTx)
                    ? 'Processing...'
                    : 'Raise Dispute'}
                </button>
              </div>
            </div>
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
