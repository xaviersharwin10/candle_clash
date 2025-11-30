import { useState, useEffect } from 'react';
import { Account } from '@aptos-labs/ts-sdk';
import { createDuel, getBalance } from '../lib/aptosClient';
import { photonService, PhotonEvents } from '../lib/photonService';
import { reportDuelCreated } from '../lib/backendClient';
import { checkPetraNetwork, isPetraInstalled, verifyAccount, getPetraNetwork } from '../lib/petraWallet';
import TopUpModal from './TopUpModal';

interface CreateDuelModalProps {
  isOpen: boolean;
  onClose: () => void;
  account: Account | string | null; // Support both Account object and Petra wallet address (string)
  onDuelCreated: (duelId: string) => void;
}

export default function CreateDuelModal({
  isOpen,
  onClose,
  account,
  onDuelCreated,
}: CreateDuelModalProps) {
  const [wagerAmount, setWagerAmount] = useState('0.1');
  const [duration, setDuration] = useState(60);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTopUp, setShowTopUp] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [networkWarning, setNetworkWarning] = useState<string | null>(null);

  // Check balance and network when modal opens
  useEffect(() => {
    if (isOpen && account) {
      const address = typeof account === 'string' ? account : account.accountAddress.toString();
      
      // Async function to handle network check and balance fetch
      const initializeModal = async () => {
        // Check network and verify account if using Petra wallet
        if (typeof account === 'string' && isPetraInstalled()) {
          const [networkCheck, accountVerify] = await Promise.all([
            checkPetraNetwork(),
            verifyAccount(address),
          ]);
          
          if (!networkCheck.isCorrect) {
            setNetworkWarning(
              `⚠️ Petra wallet is on ${networkCheck.network || 'unknown'} network. Please switch to Mainnet.`
            );
          } else if (!accountVerify.exists) {
            setNetworkWarning(
              `⚠️ Address mismatch. Petra address doesn't match. Please reconnect your wallet.`
            );
          } else {
            setNetworkWarning(null);
          }
          
          // Log network info for debugging
          const network = await getPetraNetwork();
          console.log('[CreateDuelModal] Petra network:', network);
          console.log('[CreateDuelModal] Account verification:', accountVerify);
        }
        
        // Fetch balance
        try {
          console.log('[CreateDuelModal] Fetching balance for address:', address);
          const bal = await getBalance(address);
          console.log('[CreateDuelModal] Balance fetched:', bal);
          setBalance(bal);
          
          // If balance is 0, show a helpful message
          if (bal === 0) {
            console.warn('[CreateDuelModal] Balance is 0. This could mean:');
            console.warn('  1. Account is not initialized (needs at least one transaction)');
            console.warn('  2. Network mismatch (Petra on different network)');
            console.warn('  3. Account truly has 0 balance');
          }
        } catch (err) {
          console.error('[CreateDuelModal] Error fetching balance:', err);
          setBalance(0);
        }
      };
      
      initializeModal();
    }
  }, [isOpen, account]);

  const handleCreate = async () => {
    if (!account) {
      setError('Please connect your wallet first');
      return;
    }

    const wager = parseFloat(wagerAmount);
    if (isNaN(wager) || wager <= 0) {
      setError('Please enter a valid wager amount');
      return;
    }

    // Get address for balance check and Photon event
    const playerAddress = typeof account === 'string' ? account : account.accountAddress.toString();
    
    // Check balance
    const currentBalance = balance ?? await getBalance(playerAddress);
    if (currentBalance < wager) {
      setShowTopUp(true);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const txHash = await createDuel(account, wager, duration);
      
      // Track Photon event: duel_created
      await photonService.trackEvent(
        `duel_created-${txHash}-${Date.now()}`,
        PhotonEvents.DUEL_CREATED,
        { txHash, wager, duration, playerAddress }
      );
      
      // Report to leaderboard
      await reportDuelCreated(playerAddress, wager);
      
      onDuelCreated(txHash);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create duel');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
        <div
          className="glass-card p-8 max-w-md w-full mx-4 animate-slide-up"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-white">
              Create Duel
            </h2>
            <button
              onClick={onClose}
              className="text-white/40 hover:text-white transition-colors text-2xl w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/5"
            >
              ×
            </button>
          </div>

          <div className="space-y-5">
            <div>
              <label className="block text-white/80 text-sm font-medium mb-2">
                Wager Amount (APT)
              </label>
              <input
                type="number"
                value={wagerAmount}
                onChange={(e) => setWagerAmount(e.target.value)}
                step="0.01"
                min="0.01"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white text-base font-mono focus:outline-none focus:border-cyberpunk-primary focus:ring-1 focus:ring-cyberpunk-primary transition-all"
                placeholder="0.1"
              />
              {balance !== null && (
                <div className="text-xs text-white/50 mt-2">
                  Balance: <span className="text-cyberpunk-primary font-semibold">{balance.toFixed(4)} APT</span>
                </div>
              )}
            </div>

            <div>
              <label className="block text-white/80 text-sm font-medium mb-3">
                Duration
              </label>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { value: 60, label: '1m' },
                  { value: 120, label: '2m' },
                  { value: 300, label: '5m' },
                  { value: 600, label: '10m' },
                  { value: 1800, label: '30m' },
                  { value: 21600, label: '6h' }, // 6 hours
                  { value: 43200, label: '12h' }, // 12 hours
                  { value: 86400, label: '24h' }, // 24 hours
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setDuration(option.value)}
                    className={`px-4 py-3 rounded-lg font-semibold text-sm transition-all ${
                      duration === option.value
                        ? 'bg-cyberpunk-primary text-black border-2 border-cyberpunk-primary'
                        : 'bg-white/5 text-white/80 border border-white/10 hover:bg-white/10 hover:border-white/20'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {networkWarning && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-yellow-400 text-sm space-y-2">
                <div>⚠️ {networkWarning}</div>
                {typeof account === 'string' && (
                  <div className="text-xs text-yellow-300/80 mt-2">
                    <div>Address: <span className="font-mono">{account.slice(0, 10)}...{account.slice(-8)}</span></div>
                    <a
                      href={`https://explorer.aptoslabs.com/account/${account}?network=mainnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-yellow-200 mt-1 inline-block"
                    >
                      View on Aptos Explorer →
                    </a>
                  </div>
                )}
              </div>
            )}
            
            {balance === 0 && !networkWarning && (
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 text-blue-400 text-sm">
                <div>ℹ️ Balance shows 0. This could mean:</div>
                <ul className="list-disc list-inside mt-2 text-xs space-y-1 text-blue-300/80">
                  <li>Account needs initialization (send yourself a small transaction)</li>
                  <li>Network mismatch (check Petra is on Devnet)</li>
                  <li>Rate limiting (wait a few seconds and try again)</li>
                </ul>
                {typeof account === 'string' && (
                  <a
                    href={`https://explorer.aptoslabs.com/account/${account}?network=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs underline hover:text-blue-200 mt-2 inline-block"
                  >
                    Check balance on Aptos Explorer →
                  </a>
                )}
              </div>
            )}

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
                {error}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                onClick={handleCreate}
                disabled={isLoading}
                className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-black border-t-transparent"></div>
                    Creating...
                  </span>
                ) : (
                  'Create Duel'
                )}
              </button>
              <button
                onClick={onClose}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>

      <TopUpModal
        isOpen={showTopUp}
        onClose={() => setShowTopUp(false)}
        userAddress={account ? (typeof account === 'string' ? account : account.accountAddress.toString()) : undefined}
      />
    </>
  );
}

