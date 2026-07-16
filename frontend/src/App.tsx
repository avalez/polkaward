import { ApiPromise, WsProvider } from '@polkadot/api';
import { Abi, CodePromise, ContractPromise } from '@polkadot/api-contract';
import type { Signer } from '@polkadot/api/types';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

const GITHUB_APPROVAL_API = '/github/approval';
const API_BASE_URL = import.meta.env.DEV ? 'http://127.0.0.1:3000' : '';
import {
  useInstalledWallets,
  useWallet,
} from 'useink';
import contractMetadata from './assets/polkaward.contract.json';
import metadata from './assets/polkaward.json';

const LOCAL_RPC = 'ws://127.0.0.1:9944';
const DEFAULT_DECIMALS = 12;
const MAX_STORAGE_DEPOSIT_LIMIT = (1n << 128n) - 1n;
const polkawardAbi = new Abi(contractMetadata);

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

const stateFromOutput = (output: unknown) => {
  const json = output && typeof output === 'object' && 'toJSON' in output
    ? (output as { toJSON: () => unknown }).toJSON()
    : output;

  if (typeof json === 'string') {
    return json;
  }

  if (!json || typeof json !== 'object') {
    return 'Unknown';
  }

  const outer = json as Record<string, unknown>;
  const ok = outer.ok ?? outer.Ok;

  if (typeof ok === 'string') {
    return ok;
  }

  if (ok && typeof ok === 'object') {
    return Object.keys(ok as Record<string, unknown>)[0] ?? 'Unknown';
  }

  return Object.keys(outer)[0] ?? 'Unknown';
};

const resolveContractQueryMethod = (
  contract: ContractPromise,
  methodName: string,
) => {
  const queryApi = contract.query as unknown as Record<string, unknown>;

  if (typeof queryApi[methodName] === 'function') {
    return queryApi[methodName] as (accountId: string, options: unknown, ...args: unknown[]) => Promise<unknown>;
  }

  const camelCase = methodName.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
  const snakeCase = methodName.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  const candidates = [camelCase, snakeCase];

  for (const candidate of candidates) {
    if (typeof queryApi[candidate] === 'function') {
      return queryApi[candidate] as (accountId: string, options: unknown, ...args: unknown[]) => Promise<unknown>;
    }
  }

  return undefined;
};

const getGasLimit = (api: ApiPromise) => {
  const systemConsts = api.consts.system as unknown as {
    blockWeights?: {
      toJSON: () => {
        maxBlock: { refTime: string | number; proofSize: string | number };
        perClass?: {
          normal?: {
            maxExtrinsic?: { refTime: string | number; proofSize: string | number } | null;
            maxTotal?: { refTime: string | number; proofSize: string | number } | null;
          };
        };
      };
    };
    maximumBlockWeight?: unknown;
  };

  const blockWeights = systemConsts.blockWeights?.toJSON();
  const normalLimits = blockWeights?.perClass?.normal;
  const transactionLimit =
    normalLimits?.maxExtrinsic ?? normalLimits?.maxTotal ?? blockWeights?.maxBlock;

  if (transactionLimit) {
    // maxBlock is not a valid gas limit: normal transactions have a lower
    // per-extrinsic cap and the extrinsic wrapper also consumes weight.
    return api.registry.createType('Weight', {
      refTime: (BigInt(transactionLimit.refTime) * 8n) / 10n,
      proofSize: (BigInt(transactionLimit.proofSize) * 8n) / 10n,
    }) as Parameters<ContractPromise['tx']['call']>[0]['gasLimit'];
  }

  return systemConsts.maximumBlockWeight as Parameters<ContractPromise['tx']['call']>[0]['gasLimit'];
};

const extractContractAddress = (result: {
  contract?: { address?: { toString: () => string } };
  events?: Array<{
    event?: {
      section?: string;
      method?: string;
      data?: Array<{ toString?: () => string }>;
    };
  }>;
}) => {
  const directAddress = result.contract?.address?.toString?.();
  if (directAddress) {
    return directAddress;
  }

  for (const record of result.events ?? []) {
    const event = record.event;
    if (!event || (event.section !== 'contracts' && event.section !== 'revive')) {
      continue;
    }

    if (event.method !== 'Instantiated') {
      continue;
    }

    const contractId = event.data?.[1] ?? event.data?.[0];
    const address = contractId?.toString?.();

    if (address) {
      return address;
    }
  }

  return '';
};

type SignAndSendStatus = 'None' | 'PendingSignature' | 'InBlock' | 'Finalized';

function EscrowInstance({
  accountAddress,
  api,
  address,
  signer,
}: {
  accountAddress: string;
  api: ApiPromise;
  address: string;
  signer?: Signer;
}) {
  const contract = useMemo(
    () => new ContractPromise(api, polkawardAbi, address),
    [address, api],
  );
  const [stateStr, setStateStr] = useState('Loading...');
  const [actionStatus, setActionStatus] = useState<SignAndSendStatus>('None');
  const [actionError, setActionError] = useState('');
  const isTerminalState = stateStr === 'Completed' || stateStr === 'Refunded';
  const formattedAddress = useMemo(
    () =>
      address.length > 16
        ? `${address.slice(0, 8)}...${address.slice(-8)}`
        : address,
    [address],
  );

  const refreshState = async () => {
    try {
      const queryMethod = resolveContractQueryMethod(contract, 'get_state');
      const effectiveAddress = accountAddress || '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';

      if (!queryMethod) {
        throw new Error('The contract does not expose a state query method.');
      }

      const result = await queryMethod(effectiveAddress, {
        gasLimit: getGasLimit(api),
        storageDepositLimit: null,
      });

      const output = (result as { output?: unknown }).output;
      setStateStr(stateFromOutput(output));
    } catch (error) {
      setStateStr('Unknown');
      setActionError(
        error instanceof Error ? error.message : 'Failed to read escrow state.',
      );
    }
  };

  useEffect(() => {
    void refreshState();
  }, [contract, accountAddress]);

  const signMessage = (message: 'releasePayment' | 'refundClient' | 'raiseDispute') => {
    if (!signer) {
      setActionError('Connect a wallet signer to perform escrow actions.');
      return;
    }

    setActionError('');
    setActionStatus('PendingSignature');

    contract.tx[message]({
      gasLimit: getGasLimit(api),
      storageDepositLimit: null,
    })
      .signAndSend(
        accountAddress,
        { signer },
        (result) => {
          if (result.status.isInBlock) {
            setActionStatus('InBlock');
            void refreshState();
          }

          if (result.status.isFinalized) {
            setActionStatus('Finalized');
            void refreshState();
          }

          if (result.dispatchError) {
            setActionError(result.dispatchError.toString());
            setActionStatus('None');
          }
        },
      )
      .catch((error: unknown) => {
        setActionStatus('None');
        setActionError(
          error instanceof Error ? error.message : 'Transaction failed.',
        );
      });
  };

  const isActionPending =
    actionStatus === 'PendingSignature' || actionStatus === 'InBlock';

  return (
    <>
      <div className='my-6 border-y border-slate-800 py-4'>
        <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
          <div>
            <span className='text-sm text-slate-400'>Active Escrow</span>
            <p className='mt-1 break-all font-mono text-sm text-slate-200'>
              {formattedAddress}
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

      <div className='flex flex-col gap-3'>
        {actionError ? (
          <p className='rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200'>
            {actionError}
          </p>
        ) : null}

        <button
          className='h-11 w-full rounded-md bg-emerald-500 px-4 font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400'
          disabled={isActionPending || isTerminalState}
          onClick={() => signMessage('releasePayment')}
          type='button'
        >
          {isActionPending ? 'Processing...' : 'Release Payment'}
        </button>

        <button
          className='h-11 w-full rounded-md bg-cyan-500 px-4 font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400'
          disabled={isActionPending || isTerminalState}
          onClick={() => signMessage('refundClient')}
          type='button'
        >
          {isActionPending ? 'Processing...' : 'Refund Client'}
        </button>

        <button
          className='h-11 w-full rounded-md bg-rose-500 px-4 font-semibold text-slate-950 transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400'
          disabled={isActionPending || stateStr !== 'AwaitingApproval' || !signer}
          onClick={() => signMessage('raiseDispute')}
          type='button'
        >
          {isActionPending ? 'Processing...' : 'Raise Dispute'}
        </button>
      </div>
    </>
  );
}

function App() {
  const { account, connect } = useWallet();
  const wallets = useInstalledWallets();
  const wallet = wallets[0];
  const [api, setApi] = useState<ApiPromise>();
  const [apiError, setApiError] = useState('');
  const [activeContractAddress, setActiveContractAddress] = useState(
    () => import.meta.env.VITE_CONTRACT_ADDRESS || '',
  );
  const [provider, setProvider] = useState('0x1111111111111111111111111111111111111111');
  const [arbitrator, setArbitrator] = useState('0x2222222222222222222222222222222222222222');
  const [duration, setDuration] = useState('100');
  const [deposit, setDeposit] = useState('1');
  const [formError, setFormError] = useState('');
  const [deployError, setDeployError] = useState('');
  const [deployStatus, setDeployStatus] = useState<SignAndSendStatus>('None');
  const [githubRepo, setGithubRepo] = useState('avalez/polkaward');
  const [githubApprovalStatus, setGithubApprovalStatus] = useState('');

  useEffect(() => {
    let active = true;
    let apiPromise: ApiPromise | undefined;

    ApiPromise.create({ provider: new WsProvider(LOCAL_RPC) })
      .then((createdApi) => {
        if (!active) {
          void createdApi.disconnect();
          return;
        }

        apiPromise = createdApi;
        setApi(createdApi);
        setApiError('');
      })
      .catch((error: unknown) => {
        setApiError(
          error instanceof Error
            ? error.message
            : `Could not connect to ${LOCAL_RPC}.`,
        );
      });

    return () => {
      active = false;
      void apiPromise?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (api && account?.wallet?.extension?.signer) {
      api.setSigner(account.wallet.extension.signer);
    }
  }, [api, account?.wallet?.extension?.signer]);

  const isCreatingEscrow =
    deployStatus === 'PendingSignature' || deployStatus === 'InBlock';
  const createButtonLabel = isCreatingEscrow
    ? 'Creating...'
    : 'Create Funded Escrow';
  const deploymentError = formError || deployError || apiError;
  const signer = account?.wallet?.extension?.signer as Signer | undefined;

  const connectGitHubApproval = async () => {
    if (!account?.address) {
      setGithubApprovalStatus('Connect a wallet first.');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}${GITHUB_APPROVAL_API}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          repo: githubRepo,
          walletAddress: account.address,
          installationId: 'local-demo',
        }),
      });

      let data: { success?: boolean; error?: string } = {};

      try {
        data = await response.json();
      } catch {
        data = {};
      }

      if (!response.ok || data.success === false) {
        throw new Error(data.error || 'Could not register GitHub approval.');
      }

      setGithubApprovalStatus(`GitHub approval linked for ${githubRepo}.`);
    } catch (error) {
      setGithubApprovalStatus(error instanceof Error ? error.message : 'GitHub approval failed.');
    }
  };

  const createEscrow = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');
    setDeployError('');

    if (!api) {
      setFormError(`Not connected to ${LOCAL_RPC} yet.`);
      return;
    }

    if (!account?.wallet?.extension?.signer) {
      setFormError('Wallet signer is not ready.');
      return;
    }

    const durationBlocks = Number(duration);

    if (!Number.isSafeInteger(durationBlocks) || durationBlocks <= 0) {
      setFormError('Duration must be a positive whole number of blocks.');
      return;
    }

    let value: string;

    try {
      value = parseTokenAmount(deposit, DEFAULT_DECIMALS);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Invalid deposit.');
      return;
    }

    setDeployStatus('PendingSignature');

    try {
      const mappedAddress = await api.call.reviveApi.address(account.address);
      const originalAccount = await api.query.revive.originalAccount(mappedAddress) as unknown as {
        isNone: boolean;
      };

      if (originalAccount.isNone) {
        await new Promise<void>((resolve, reject) => {
          let unsubscribe: (() => void) | undefined;

          api.tx.revive
            .mapAccount()
            .signAndSend(
              account.address,
              { signer: signer! },
              (result) => {
                if (result.dispatchError) {
                  unsubscribe?.();
                  reject(new Error(result.dispatchError.toString()));
                  return;
                }

                if (result.status.isFinalized) {
                  unsubscribe?.();
                  resolve();
                }
              },
            )
            .then((stop) => {
              unsubscribe = stop;
            })
            .catch(reject);
        });
      }
    } catch (error) {
      setDeployStatus('None');
      setDeployError(
        error instanceof Error ? error.message : 'Account mapping failed.',
      );
      return;
    }

    const code = new CodePromise(
      api,
      polkawardAbi,
      contractMetadata.source.contract_binary,
    );

    code.tx
      .new(
        {
          gasLimit: getGasLimit(api),
          // pallet-revive uses a mandatory Balance here; null is encoded as zero.
          // Only the deposit actually consumed is held from the caller.
          storageDepositLimit: MAX_STORAGE_DEPOSIT_LIMIT,
          value,
        },
        provider.trim(),
        arbitrator.trim(),
        durationBlocks,
      )
      .signAndSend(account.address, { signer: signer! }, (result) => {
        if (result.status.isInBlock) {
          setDeployStatus('InBlock');
        }

        if (result.status.isFinalized) {
          setDeployStatus('Finalized');
        }

        const contractAddress = extractContractAddress(result as Parameters<typeof extractContractAddress>[0]);
        if (contractAddress) {
          setActiveContractAddress(contractAddress);
        }

        if (result.dispatchError) {
          setDeployError(result.dispatchError.toString());
          setDeployStatus('None');
        }
      })
      .catch((error: unknown) => {
        setDeployStatus('None');
        setDeployError(
          error instanceof Error ? error.message : 'Deployment failed.',
        );
      });
  };

  return (
    <main className='min-h-screen bg-slate-950 px-4 py-8 text-slate-100 md:px-6 md:py-12'>
      <section className='mx-auto flex min-h-[calc(100vh-6rem)] w-full max-w-2xl flex-col justify-center'>
        <div className='rounded-lg border border-slate-800 bg-slate-900 p-6 shadow-xl shadow-black/20'>
          <h1 className='text-2xl font-bold'>
            {formatContractName(metadata.contract.name)}
          </h1>

          {account ? (
            <div className='mt-6 flex flex-col gap-6'>
              <div className='rounded-lg border border-slate-800 bg-slate-950/70 p-4'>
                <h2 className='text-lg font-semibold text-slate-100'>GitHub App approval flow</h2>
                <p className='mt-2 text-sm text-slate-400'>Register a repository so webhook events can prompt an approval that is signed from your connected wallet.</p>
                <div className='mt-4 flex flex-col gap-3 sm:flex-row'>
                  <input
                    className='h-11 flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400'
                    onChange={(event) => setGithubRepo(event.currentTarget.value)}
                    placeholder='owner/repo'
                    type='text'
                    value={githubRepo}
                  />
                  <button
                    className='h-11 rounded-md bg-emerald-500 px-4 font-semibold text-slate-950 transition hover:bg-emerald-400'
                    onClick={() => void connectGitHubApproval()}
                    type='button'
                  >
                    Link GitHub Repo
                  </button>
                </div>
                {githubApprovalStatus ? (
                  <p className='mt-3 text-sm text-cyan-300'>{githubApprovalStatus}</p>
                ) : null}
              </div>

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
                    Deposit
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

                {activeContractAddress ? (
                  <p className='rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200'>
                    Escrow contract {activeContractAddress}
                  </p>
                ) : null}

                <button
                  className='h-11 w-full rounded-md bg-cyan-400 px-4 font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400'
                  disabled={isCreatingEscrow || !api}
                  type='submit'
                >
                  {createButtonLabel}
                </button>
              </form>

              {activeContractAddress && api ? (
                <EscrowInstance
                  accountAddress={account?.address ?? ''}
                  address={activeContractAddress}
                  api={api}
                  signer={signer}
                />
              ) : (
                <div className='border-y border-slate-800 py-4'>
                  <span className='text-sm text-slate-400'>Active Escrow</span>
                  <p className='mt-1 text-sm text-slate-200'>No escrow yet</p>
                </div>
              )}
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
