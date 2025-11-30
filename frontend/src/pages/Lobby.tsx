import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Account } from '@aptos-labs/ts-sdk';
import { listAllDuels, joinDuel, getDuel } from '../lib/aptosClient';
import type { DuelInfo } from '../lib/aptosClient';
import { photonService, PhotonEvents } from '../lib/photonService';
import { reportDuelJoined } from '../lib/backendClient';
import CreateDuelModal from '../components/CreateDuelModal';

interface LobbyProps {
  account: Account | string | null; // Support both Account object and Petra wallet address (string)
  userAddress: string | null;
}

export default function Lobby({ account, userAddress }: LobbyProps) {
  const navigate = useNavigate();
  const [allDuels, setAllDuels] = useState<DuelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [joiningDuelId, setJoiningDuelId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'active' | 'resolved'>('all');

  // Fetch all duels
  const fetchAllDuels = async () => {
    try {
      setLoading(true);
      const duels = await listAllDuels();
      setAllDuels(duels);
    } catch (error) {
      console.error('Error fetching duels:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Fetch duels once when page loads
    fetchAllDuels();
  }, []);

  const handleJoinDuel = async (duelId: number) => {
    if (!account || !userAddress) {
      alert('Please connect your wallet first');
      return;
    }

    const duel = await getDuel(duelId);
    if (!duel) {
      alert('Duel not found');
      return;
    }

    if (duel.player1.toLowerCase() === userAddress.toLowerCase()) {
      alert('You cannot join your own duel');
      return;
    }

    if (duel.player2 !== '0x0') {
      alert('This duel is already full');
      return;
    }

    try {
      setJoiningDuelId(duelId);
      
      // Use account (Account object or string address) for joinDuel
      const accountToUse = account || userAddress;
      if (!accountToUse) {
        alert('Please connect your wallet first');
        return;
      }
      
      const txHash = await joinDuel(accountToUse, duelId);
      
      // Track Photon event: duel_joined
      await photonService.trackEvent(
        `duel_joined-${duelId}-${Date.now()}`,
        PhotonEvents.DUEL_JOINED,
        { duelId, txHash, playerAddress: userAddress, opponentAddress: duel.player1 }
      );
      
      // Report to leaderboard
      await reportDuelJoined(userAddress, duel.wagerAmount / 1_000_000_000); // Convert octas to APT
      
      // Refresh duels list
      await fetchAllDuels();
      
      // Navigate to duel view
      navigate(`/duel/${duelId}`);
    } catch (error: any) {
      console.error('Error joining duel:', error);
      alert(error.message || 'Failed to join duel');
    } finally {
      setJoiningDuelId(null);
    }
  };

  const handleDuelCreated = () => {
    setShowCreateModal(false);
    fetchAllDuels(); // Refresh the list
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(seconds / 3600);
    return `${hours}h`;
  };

  const formatAddress = (address: string) => {
    if (!address || address === '0x0') return 'Waiting...';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const getStatusBadge = (status: DuelInfo['status']) => {
    const badges = {
      open: { text: 'Open', color: 'bg-cyberpunk-primary/20 text-cyberpunk-primary border-cyberpunk-primary/30' },
      active: { text: 'Active', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
      resolved: { text: 'Resolved', color: 'bg-white/10 text-white/60 border-white/10' },
    };
    const badge = badges[status];
    return (
      <span className={`px-3 py-1 text-xs font-semibold rounded-full border ${badge.color}`}>
        {badge.text}
      </span>
    );
  };

  const filteredDuels = statusFilter === 'all' 
    ? allDuels 
    : allDuels.filter(duel => duel.status === statusFilter);

  return (
    <div className="min-h-[calc(100vh-80px)] p-8">
      <div className="w-full max-w-[1920px] mx-auto space-y-6 animate-fade-in">
        {/* Header */}
        <div className="glass-card p-8">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-6">
              <img src="/assets/logo.jpg" alt="Candle Clash" className="w-16 h-16 rounded-full border border-cyberpunk-primary/50" />
              <div>
                <h1 className="text-4xl font-bold text-white mb-2">
                  Candle Clash
                </h1>
                <p className="text-white/60">1v1 Trading Battle Arena</p>
              </div>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn-primary"
              disabled={!account}
            >
              Create Duel
            </button>
          </div>
        </div>

        {/* Duels Section */}
        <div className="glass-card p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-white">
              All Duels
            </h2>
            <div className="flex items-center gap-4">
              {/* Status Filter */}
              <div className="flex gap-2">
                {(['all', 'open', 'active', 'resolved'] as const).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setStatusFilter(filter)}
                    className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                      statusFilter === filter
                        ? 'bg-cyberpunk-primary text-black'
                        : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {filter.charAt(0).toUpperCase() + filter.slice(1)}
                  </button>
                ))}
              </div>
              <button
                onClick={fetchAllDuels}
                className="text-sm text-white/60 hover:text-white transition-colors px-3 py-2 hover:bg-white/5 rounded-lg"
                disabled={loading}
              >
                {loading ? 'Loading...' : '🔄 Refresh'}
              </button>
            </div>
          </div>

          {loading && allDuels.length === 0 ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-cyberpunk-primary border-t-transparent mx-auto mb-4"></div>
              <p className="text-white/60">Loading duels...</p>
            </div>
          ) : filteredDuels.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-4xl mb-4">⚔️</div>
              <h3 className="text-xl font-semibold text-white mb-2">
                No duels found
              </h3>
              <p className="text-white/60 mb-6">
                {statusFilter === 'all' 
                  ? 'Be the first to create a duel and start a battle!'
                  : `No ${statusFilter} duels at the moment.`}
              </p>
              {statusFilter === 'all' && (
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="btn-primary"
                  disabled={!account}
                >
                  Create First Duel
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredDuels.map((duel) => (
                <div
                  key={duel.duelId}
                  className="glass-card p-5 hover-lift flex flex-col space-y-4"
                >
                  {/* Header with ID and Status */}
                  <div className="flex justify-between items-start">
                    <div className="text-white font-bold text-lg">
                      Duel #{duel.duelId}
                    </div>
                    {getStatusBadge(duel.status)}
                  </div>

                  {/* Wager Amount */}
                  <div className="space-y-1">
                    <div className="text-white/60 text-xs">Wager</div>
                    <div className="text-cyberpunk-primary font-bold text-xl">
                      {duel.wagerAmount.toFixed(2)} APT
                    </div>
                  </div>

                  {/* Players */}
                  <div className="space-y-2">
                    <div className="text-white/60 text-xs">Players</div>
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <span className="text-white/80 text-sm">Player 1:</span>
                        <span className="text-white font-mono text-xs">
                          {formatAddress(duel.player1)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-white/80 text-sm">Player 2:</span>
                        <span className="text-white font-mono text-xs">
                          {formatAddress(duel.player2)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Duration */}
                  <div className="flex items-center justify-between pt-2 border-t border-white/10">
                    <span className="text-white/60 text-xs">Duration</span>
                    <span className="text-cyberpunk-primary font-semibold text-sm">
                      {formatDuration(duel.durationSecs)}
                    </span>
                  </div>

                  {/* Winner Info for Resolved Duels */}
                  {duel.status === 'resolved' && duel.winner && (
                    <div className="px-3 py-2 bg-cyberpunk-primary/10 border border-cyberpunk-primary/20 rounded-lg">
                      <div className="text-white/60 text-xs mb-1">Winner</div>
                      <div className="text-cyberpunk-primary font-mono text-xs font-semibold">
                        {formatAddress(duel.winner)}
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="space-y-2 mt-2">
                    {duel.status === 'open' && (
                      <button
                        onClick={() => handleJoinDuel(duel.duelId)}
                        disabled={
                          !account || 
                          !userAddress ||
                          joiningDuelId === duel.duelId || 
                          userAddress.toLowerCase() === duel.player1.toLowerCase()
                        }
                        className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed text-sm py-2"
                      >
                        {joiningDuelId === duel.duelId ? (
                          <span className="flex items-center justify-center gap-2">
                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-black border-t-transparent"></div>
                            Joining...
                          </span>
                        ) : !account || !userAddress ? (
                          'Connect Wallet'
                        ) : userAddress.toLowerCase() === duel.player1.toLowerCase() ? (
                          'Your Duel'
                        ) : (
                          'Join Duel'
                        )}
                      </button>
                    )}
                    <Link
                      to={`/duel/${duel.duelId}`}
                      className="btn-secondary w-full text-sm py-2 text-center block"
                    >
                      View Details
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Info Section */}
        <div className="glass-card p-8">
          <h3 className="text-xl font-bold text-white mb-6">
            How It Works
          </h3>
          <ul className="space-y-3 text-white/80">
            <li className="flex items-start gap-3">
              <span className="text-cyberpunk-primary mt-1">•</span>
              <span>Create a duel with your wager amount and duration</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-cyberpunk-primary mt-1">•</span>
              <span>Wait for an opponent to join your duel</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-cyberpunk-primary mt-1">•</span>
              <span>Once joined, both players trade and compete for the best P&L</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-cyberpunk-primary mt-1">•</span>
              <span>The player with the highest P&L percentage wins the pot</span>
            </li>
          </ul>
        </div>
      </div>

      {/* Create Duel Modal */}
      {account && (
        <CreateDuelModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          account={account}
          onDuelCreated={handleDuelCreated}
        />
      )}
    </div>
  );
}
