import { useState, useEffect } from 'react';
import { isPetraInstalled, connectPetra, disconnectPetra, getPetraAccount, switchPetraAccount } from '../lib/petraWallet';

interface PetraWalletButtonProps {
  onConnect: (address: string) => void;
  onDisconnect: () => void;
}

export default function PetraWalletButton({ onConnect, onDisconnect }: PetraWalletButtonProps) {
  const [address, setAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if already connected on mount
  useEffect(() => {
    const checkConnection = async () => {
      if (isPetraInstalled()) {
        const account = await getPetraAccount();
        if (account) {
          setAddress(account);
          onConnect(account);
        }
      }
    };
    checkConnection();
  }, [onConnect]);

  const handleConnect = async () => {
    if (!isPetraInstalled()) {
      setError('Petra wallet is not installed. Please install it from https://petra.app/');
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      const result = await connectPetra();
      console.log('[PetraWalletButton] Connected address:', result.address);
      console.log('[PetraWalletButton] Address type:', typeof result.address);
      console.log('[PetraWalletButton] Address length:', result.address?.length);
      
      setAddress(result.address);
      onConnect(result.address);
      
      // Store in sessionStorage
      sessionStorage.setItem('petra_address', result.address);
    } catch (err: any) {
      setError(err.message || 'Failed to connect to Petra wallet');
      console.error('Petra connection error:', err);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleSwitchAccount = async () => {
    setIsConnecting(true);
    setError(null);

    try {
      const result = await switchPetraAccount();
      setAddress(result.address);
      onConnect(result.address);
      sessionStorage.setItem('petra_address', result.address);
    } catch (err: any) {
      if (err.message?.includes('rejected')) {
        // User cancelled, just ignore
        setError(null);
      } else {
        setError(err.message || 'Failed to switch account');
      }
      console.error('Petra switch account error:', err);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnectPetra();
      setAddress(null);
      sessionStorage.removeItem('petra_address');
      onDisconnect();
    } catch (err) {
      console.error('Petra disconnect error:', err);
    }
  };

  if (!isPetraInstalled()) {
    return (
      <div className="space-y-2">
        <a
          href="https://petra.app/"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary inline-block text-center"
        >
          Install Petra Wallet
        </a>
        <p className="text-xs text-white/60 text-center">
          Install Petra wallet to connect
        </p>
      </div>
    );
  }

  if (address) {
    return (
      <div className="space-y-2">
        <div className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white/80 text-sm font-mono">
          {address.slice(0, 6)}...{address.slice(-4)}
        </div>
        <button
          onClick={handleSwitchAccount}
          disabled={isConnecting}
          className="btn-primary w-full text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          title="Switch to a different account"
        >
          {isConnecting ? (
            <span className="flex items-center justify-center gap-2">
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-black border-t-transparent"></div>
              Switching...
            </span>
          ) : (
            '🔄 Switch Account'
          )}
        </button>
        <button
          onClick={handleDisconnect}
          className="btn-secondary w-full text-sm"
        >
          Disconnect
        </button>
        {error && (
          <p className="text-xs text-red-400 text-center">{error}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleConnect}
        disabled={isConnecting}
        className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isConnecting ? (
          <span className="flex items-center justify-center gap-2">
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-black border-t-transparent"></div>
            Connecting...
          </span>
        ) : (
          'Connect Petra Wallet'
        )}
      </button>
      {error && (
        <p className="text-xs text-red-400 text-center">{error}</p>
      )}
    </div>
  );
}

