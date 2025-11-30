import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Account } from '@aptos-labs/ts-sdk';
import TradingView from './TradingView';
import { getDuel, joinDuel, listAllDuels } from '../lib/aptosClient';
import type { DuelInfo } from '../lib/aptosClient';

interface DuelViewProps {
  account: Account | string | null;
  userAddress: string | null;
}

export default function DuelView({ account, userAddress }: DuelViewProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const duelId = id ? parseInt(id, 10) : null;

  const [duelInfo, setDuelInfo] = useState<DuelInfo | null>(null);
  const [duelStatus, setDuelStatus] = useState<DuelInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);

  // Fetch duel details and update status
  const fetchDuelDetails = async () => {
    if (duelId === null) return;

    try {
      // Skip cache for duel detail page - always fetch fresh data
      const info = await getDuel(duelId, true); // skipCache = true
      if (info) {
        setDuelInfo(info);
        
        // Calculate time remaining if active
        if (info.startTime > 0 && info.player2 !== '0x0' && info.player2 !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
          const now = Math.floor(Date.now() / 1000);
          const endTime = info.startTime + info.durationSecs;
          const remaining = Math.max(0, endTime - now);
          setTimeRemaining(remaining);
        } else {
          setTimeRemaining(null);
        }

        // Get full duel status info (force refresh to get latest status)
        const allDuels = await listAllDuels(true); // forceRefresh = true
        const duel = allDuels.find(d => d.duelId === duelId);
        if (duel) {
          setDuelStatus(duel);
        }
      } else {
        setError('Duel not found.');
      }
    } catch (err) {
      console.error('Error fetching duel details:', err);
      setError('Failed to load duel details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (duelId === null) {
      navigate('/lobby');
      return;
    }

      // Fetch duel details once when page loads
      fetchDuelDetails();
  }, [duelId, navigate]);

  const handleJoinDuel = async () => {
    if (!account || !userAddress || !duelId) {
      alert('Please connect your wallet first');
      return;
    }

    if (duelInfo?.player1.toLowerCase() === userAddress.toLowerCase()) {
      alert('You cannot join your own duel');
      return;
    }

    const player2 = duelInfo?.player2 || '0x0';
    if (player2 !== '0x0' && player2 !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
      alert('This duel is already full');
      return;
    }

    try {
      setJoining(true);
      const accountToUse = account || userAddress;
      await joinDuel(accountToUse, duelId);
      // Refresh duel info
      await fetchDuelDetails();
    } catch (error: any) {
      console.error('Error joining duel:', error);
      alert(error.message || 'Failed to join duel');
    } finally {
      setJoining(false);
    }
  };

  const formatAddress = (address: string) => {
    if (!address || address === '0x0' || address === '0x0000000000000000000000000000000000000000000000000000000000000000') {
      return 'Waiting for player...';
    }
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(seconds / 3600);
    return `${hours}h`;
  };

  const formatTimeRemaining = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
      return `${hours}h ${mins}m ${secs}s`;
    }
    return `${mins}m ${secs}s`;
  };

  const getStatusBadge = (status: string) => {
    const badges: Record<string, { text: string; color: string }> = {
      open: { text: 'Open', color: 'bg-cyberpunk-primary/20 text-cyberpunk-primary border-cyberpunk-primary/30' },
      active: { text: 'Active', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
      resolved: { text: 'Resolved', color: 'bg-white/10 text-white/60 border-white/10' },
    };
    const badge = badges[status] || badges.resolved;
    return (
      <span className={`px-3 py-1 text-xs font-semibold rounded-full border ${badge.color}`}>
        {badge.text}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-80px)] flex items-center justify-center p-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-cyberpunk-primary border-t-transparent mx-auto mb-4"></div>
          <p className="text-white/60">Loading duel details...</p>
        </div>
      </div>
    );
  }

  if (error || !duelInfo) {
    return (
      <div className="min-h-[calc(100vh-80px)] flex items-center justify-center p-8">
        <div className="text-center space-y-4">
          <div className="text-red-400 text-xl">{error || 'Duel not found'}</div>
          <Link to="/lobby" className="btn-primary inline-block">
            Back to Lobby
          </Link>
        </div>
      </div>
    );
  }

  // Determine if user is a participant
  const isPlayer1 = userAddress?.toLowerCase() === duelInfo.player1.toLowerCase();
  const isPlayer2 = userAddress?.toLowerCase() === duelInfo.player2.toLowerCase();
  const isParticipant = isPlayer1 || isPlayer2;
  const isOpen = duelInfo.player2 === '0x0' || duelInfo.player2 === '0x0000000000000000000000000000000000000000000000000000000000000000';
  const isResolved = duelInfo.isResolved;
  
  // Calculate if duel is active: both players joined, started, and not expired
  const now = Math.floor(Date.now() / 1000);
  const endTime = duelInfo.startTime + duelInfo.durationSecs;
  const isActive = !isOpen && !isResolved && duelInfo.startTime > 0 && now < endTime;

  return (
    <div className="min-h-[calc(100vh-80px)] p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Duel Header */}
        <div className="glass-card p-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">
                Duel #{duelId}
              </h1>
              {duelStatus && getStatusBadge(duelStatus.status)}
            </div>
            <Link to="/lobby" className="text-white/60 hover:text-white transition-colors">
              ← Back to Lobby
            </Link>
          </div>

          {/* Duel Info Grid */}
          <div className="grid md:grid-cols-3 gap-6 mt-6">
            <div className="space-y-2">
              <div className="text-white/60 text-sm">Wager</div>
              <div className="text-cyberpunk-primary font-bold text-2xl">
                {duelInfo.wagerAmount.toFixed(4)} APT
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-white/60 text-sm">Duration</div>
              <div className="text-cyberpunk-primary font-semibold text-xl">
                {formatDuration(duelInfo.durationSecs)}
              </div>
            </div>
            {timeRemaining !== null && (
              <div className="space-y-2">
                <div className="text-white/60 text-sm">Time Remaining</div>
                <div className="text-yellow-400 font-bold text-xl">
                  {formatTimeRemaining(timeRemaining)}
                </div>
              </div>
            )}
          </div>

          {/* Players */}
          <div className="grid md:grid-cols-2 gap-4 mt-6 pt-6 border-t border-white/10">
            <div className="space-y-2">
              <div className="text-white/60 text-sm">Player 1 (Creator)</div>
              <div className="flex items-center gap-2">
                <span className="text-white font-mono text-sm">
                  {formatAddress(duelInfo.player1)}
                </span>
                {isPlayer1 && (
                  <span className="px-2 py-1 bg-cyberpunk-primary/20 text-cyberpunk-primary text-xs rounded">
                    You
                  </span>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-white/60 text-sm">Player 2</div>
              <div className="flex items-center gap-2">
                <span className="text-white font-mono text-sm">
                  {formatAddress(duelInfo.player2)}
                </span>
                {isPlayer2 && (
                  <span className="px-2 py-1 bg-cyberpunk-primary/20 text-cyberpunk-primary text-xs rounded">
                    You
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Winner for Resolved Duels */}
          {isResolved && duelStatus?.winner && (
            <div className="mt-6 pt-6 border-t border-white/10">
              <div className="px-4 py-3 bg-cyberpunk-primary/10 border border-cyberpunk-primary/20 rounded-lg">
                <div className="text-white/60 text-sm mb-1">Winner</div>
                <div className="text-cyberpunk-primary font-mono text-lg font-semibold">
                  {formatAddress(duelStatus.winner)}
                </div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          {isOpen && !isPlayer1 && (
            <div className="mt-6">
              <button
                onClick={handleJoinDuel}
                disabled={!account || joining}
                className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {joining ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-black border-t-transparent"></div>
                    Joining...
                  </span>
                ) : (
                  'Join Duel'
                )}
              </button>
            </div>
          )}
        </div>

        {/* Trading View - Only show if both players joined and duel is active */}
        {isActive && isParticipant && userAddress && (
          <div className="glass-card p-6">
            <TradingView
              duelId={duelId!}
              playerAddress={userAddress}
              opponentAddress={isPlayer1 ? duelInfo.player2 : duelInfo.player1}
              durationSecs={duelInfo.durationSecs}
              startTime={duelInfo.startTime}
              wagerAmount={duelInfo.wagerAmount}
              account={account}
              onDuelEnd={() => {
                fetchDuelDetails();
              }}
            />
          </div>
        )}

        {/* View Only Mode - Show info if not participant or if resolved */}
        {(!isParticipant || isResolved || isOpen) && (
          <div className="glass-card p-6">
            <div className="text-center space-y-4">
              {isOpen && (
                <div>
                  <p className="text-white/80 mb-4">Waiting for player 2 to join...</p>
                  {!isPlayer1 && account && (
                    <button
                      onClick={handleJoinDuel}
                      disabled={joining}
                      className="btn-primary"
                    >
                      {joining ? 'Joining...' : 'Join This Duel'}
                    </button>
                  )}
                </div>
              )}
              {isResolved && (
                <div>
                  <p className="text-white/80">This duel has been completed.</p>
                  {duelStatus?.winner && (
                    <p className="text-cyberpunk-primary font-semibold mt-2">
                      Winner: {formatAddress(duelStatus.winner)}
                    </p>
                  )}
                </div>
              )}
              {!isParticipant && isActive && (
                <div>
                  <p className="text-white/80">This duel is in progress. Only participants can view the trading interface.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
