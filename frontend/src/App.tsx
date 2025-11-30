import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { Account } from '@aptos-labs/ts-sdk';
import AuthButton from './components/AuthButton';
import PetraWalletButton from './components/PetraWalletButton';
import DuelView from './components/DuelView';
import Lobby from './pages/Lobby';
import Leaderboard from './components/Leaderboard';
import TopUpModal from './components/TopUpModal';
import CreateDuelModal from './components/CreateDuelModal';
import { photonService } from './lib/photonService';
import { getPetraAccount, disconnectPetra } from './lib/petraWallet';
import './App.css';

function App() {
  const [account, setAccount] = useState<Account | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [isPetraWallet, setIsPetraWallet] = useState(false); // Track if using Petra wallet
  const [showTopUp, setShowTopUp] = useState(false);
  const [showCreateDuel, setShowCreateDuel] = useState(false);
  const [isLoadingSession, setIsLoadingSession] = useState(true);

  // Check for existing session (Petra wallet or ephemeral account)
  useEffect(() => {
    const loadSession = async () => {
      // First check for Petra wallet connection
      const petraAddress = await getPetraAccount();
      if (petraAddress) {
        setAddress(petraAddress);
        setIsPetraWallet(true);
        setAccount(null); // No Account object for Petra wallet
        setIsLoadingSession(false);
        return;
      }

      // Check for ephemeral account (Google OAuth)
      const stored = sessionStorage.getItem('aptos_account');
      if (stored) {
        try {
          const accountData = JSON.parse(stored);
          console.log('Loading session for address:', accountData.address);
          
          // Reconstruct Account from private key
          let privateKeyStr = accountData.privateKey;
          
          // Ensure it's a string
          if (typeof privateKeyStr !== 'string') {
            throw new Error('Invalid private key format');
          }
          
          // Ensure private key has 0x prefix for Account.fromPrivateKey
          if (!privateKeyStr.startsWith('0x')) {
            privateKeyStr = `0x${privateKeyStr}`;
          }
          
          // Create Account directly from private key hex string
          // Account.fromPrivateKey accepts a hex string directly in SDK v5
          const acc = Account.fromPrivateKey({ privateKey: privateKeyStr });
          
          // Verify the address matches
          const reconstructedAddress = acc.accountAddress.toString();
          if (accountData.address && accountData.address !== reconstructedAddress) {
            console.warn('Address mismatch, using reconstructed address');
          }
          
          setAccount(acc);
          setAddress(accountData.address || reconstructedAddress);
          setIsPetraWallet(false);
          console.log('Session loaded successfully:', reconstructedAddress);
          
          // Load Photon user from session if available
          photonService.loadFromSession();
        } catch (error) {
          console.error('Error loading session:', error);
          // Clear invalid session
          sessionStorage.removeItem('aptos_account');
          sessionStorage.removeItem('google_token');
        }
      } else {
        console.log('No session found');
      }
      setIsLoadingSession(false);
    };
    
    loadSession();
  }, []);

  const handleAuthSuccess = (acc: Account, addr: string) => {
    setAccount(acc);
    setAddress(addr);
    setIsPetraWallet(false);
  };

  const handlePetraConnect = (addr: string) => {
    setAddress(addr);
    setAccount(null); // No Account object for Petra wallet
    setIsPetraWallet(true);
  };

  const handlePetraDisconnect = async () => {
    try {
      await disconnectPetra();
    } catch (error) {
      console.error('Error disconnecting Petra:', error);
    }
    setAddress(null);
    setAccount(null);
    setIsPetraWallet(false);
    sessionStorage.removeItem('petra_address');
  };

  const handleDisconnect = async () => {
    // Clear all session data
    sessionStorage.removeItem('aptos_account');
    sessionStorage.removeItem('google_token');
    sessionStorage.removeItem('petra_address');
    
    // Clear Photon session
    photonService.clearSession();
    
    // Disconnect Petra if connected
    if (isPetraWallet) {
      try {
        await disconnectPetra();
      } catch (error) {
        console.error('Error disconnecting Petra:', error);
      }
    }
    
    // Reset state
    setAddress(null);
    setAccount(null);
    setIsPetraWallet(false);
  };


  const handleAuthError = (error: Error) => {
    console.error('Authentication error:', error);
    alert('Authentication failed. Please try again.');
  };



  // Show loading state while checking session
  if (isLoadingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-cyberpunk-primary border-t-transparent mx-auto mb-4"></div>
          <p className="text-white/60">Loading...</p>
        </div>
      </div>
    );
  }

  // Main App with Routing - Always render routes
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-cyberpunk-darker">
        {/* Navigation - Always show if authenticated */}
        {address && (
          <nav className="sticky top-0 z-50 w-full border-b border-white/5 bg-black/80 backdrop-blur-xl">
            <div className="w-full px-6 py-4 flex justify-between items-center">
              <div className="flex items-center gap-8">
                <Link to="/" className="text-xl font-bold text-white hover:text-cyberpunk-primary transition-colors">
                  Candle Clash
                </Link>
                <Link
                  to="/lobby"
                  className="text-sm text-white/60 hover:text-white transition-colors font-medium"
                >
                  Lobby
                </Link>
                <Link
                  to="/leaderboard"
                  className="text-sm text-white/60 hover:text-white transition-colors font-medium"
                >
                  Leaderboard
                </Link>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowCreateDuel(true)}
                  className="btn-primary text-sm px-4 py-2"
                >
                  ➕ Create Duel
                </button>
                {/* <button
                  onClick={() => setShowTopUp(true)}
                  className="btn-secondary text-sm px-4 py-2"
                >
                  💰 Top Up
                </button> */}
                <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg">
                  <div className="text-white/80 text-xs font-mono">
                    {address.slice(0, 6)}...{address.slice(-4)}
                  </div>
                  <span className="text-white/40 text-xs">
                    {isPetraWallet ? '🔷 Petra' : '🔐 Google'}
                  </span>
                </div>
                <button
                  onClick={handleDisconnect}
                  className="text-sm text-white/60 hover:text-white transition-colors px-3 py-1.5 hover:bg-white/5 rounded-lg"
                  title="Switch Wallet"
                >
                  🔄 Switch
                </button>
              </div>
            </div>
          </nav>
        )}

        {/* Routes */}
        <Routes>
          <Route
            path="/"
            element={
              address ? (
                <div className="min-h-[calc(100vh-80px)] flex items-center justify-center p-8">
                  <div className="text-center space-y-6 max-w-2xl animate-fade-in">
                    <h1 className="text-5xl font-bold text-white mb-2">
                      Ready to Battle?
                    </h1>
                    <p className="text-lg text-white/60 mb-8">
                      Join a duel from the lobby or create a new one.
                    </p>
                    <Link
                      to="/lobby"
                      className="btn-primary inline-block text-base"
                    >
                      Go to Lobby
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="min-h-screen flex items-center justify-center p-8">
                  <div className="text-center space-y-10 max-w-4xl w-full animate-fade-in">
                    <div className="space-y-4">
                      <h1 className="text-6xl font-bold text-white mb-4">
                        Candle Clash
                      </h1>
                      <p className="text-2xl text-white/80 font-medium">
                        1v1 Trading Battle Arena
                      </p>
                      <p className="text-lg text-white/60 max-w-xl mx-auto">
                        Battle your trading skills. Winner takes all. Skill beats capital.
                      </p>
                    </div>
                    
                    <div className="flex flex-col items-center gap-4">
                      <PetraWalletButton
                        onConnect={handlePetraConnect}
                        onDisconnect={handlePetraDisconnect}
                      />
                      {/* <div className="flex items-center gap-4 w-full max-w-xs">
                        <div className="flex-1 h-px bg-white/20"></div>
                        <span className="text-white/40 text-sm">OR</span>
                        <div className="flex-1 h-px bg-white/20"></div>
                      </div>  
                      <AuthButton
                        onAuthSuccess={handleAuthSuccess}
                        onAuthError={handleAuthError}
                      /> */}
                    </div>
                    
                    {/* <div className="max-w-3xl mx-auto mt-16 grid md:grid-cols-3 gap-6 text-left">
                      <div className="glass-card p-6 hover-lift">
                        <div className="text-3xl mb-4">🔐</div>
                        <h3 className="text-white font-semibold text-lg mb-2">Keyless Authentication</h3>
                        <p className="text-sm text-white/60 leading-relaxed">Sign in with Google - no wallet needed. We create an ephemeral Move account for you.</p>
                      </div>
                      <div className="glass-card p-6 hover-lift">
                        <div className="text-3xl mb-4">💰</div>
                        <h3 className="text-white font-semibold text-lg mb-2">Panora Integration</h3>
                        <p className="text-sm text-white/60 leading-relaxed">Need APT? Top up seamlessly through Panora's cross-chain swap.</p>
                      </div>
                      <div className="glass-card p-6 hover-lift">
                        <div className="text-3xl mb-4">⚔️</div>
                        <h3 className="text-white font-semibo ld text-lg mb-2">Move-Powered Duels</h3>
                        <p className="text-sm text-white/60 leading-relaxed">Smart contracts handle wagers, payouts, and automatic resolution based on trading performance.</p>
                      </div>
                    </div> */}
                  </div>
                </div>
              )
            }
          />
          <Route
            path="/duel/:id"
            element={<DuelView account={account || address} userAddress={address} />}
          />
          <Route
            path="/lobby"
            element={<Lobby account={isPetraWallet ? address : account} userAddress={address} />}
          />
          <Route
            path="/leaderboard"
            element={<Leaderboard userAddress={address} />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>

        {/* Modals */}
        <TopUpModal
          isOpen={showTopUp}
          onClose={() => setShowTopUp(false)}
          userAddress={address || undefined}
        />
        <CreateDuelModal
          isOpen={showCreateDuel}
          onClose={() => setShowCreateDuel(false)}
          account={isPetraWallet ? address : account}
          onDuelCreated={(txHash) => {
            console.log('Duel created:', txHash);
            setShowCreateDuel(false);
          }}
        />
      </div>
    </BrowserRouter>
  );
}

export default App;
