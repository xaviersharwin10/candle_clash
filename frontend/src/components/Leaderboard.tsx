import { useEffect, useState } from 'react';
import { getLeaderboard, getUserLeaderboardRank, claimLeaderboardReward } from '../lib/backendClient';
import { photonService } from '../lib/photonService';

interface LeaderboardEntry {
  rank: number;
  address: string;
  score: number;
  duelsCreated: number;
  duelsJoined: number;
  duelsWon: number;
  totalSwaps: number;
  totalWagerAmount: number;
}

interface LeaderboardProps {
  userAddress: string | null;
}

export default function Leaderboard({ userAddress }: LeaderboardProps) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [userRank, setUserRank] = useState<{
    rank: number | null;
    score: number;
    inTop10: boolean;
    entry: LeaderboardEntry | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [claimMessage, setClaimMessage] = useState<string | null>(null);
  const [claimDetails, setClaimDetails] = useState<{
    tokenAmount: number;
    photonWalletAddress?: string;
    eventId?: string;
  } | null>(null);

  const fetchLeaderboard = async () => {
    try {
      setLoading(true);
      const data = await getLeaderboard(10);
      if (data) {
        setLeaderboard(data.leaderboard);
      }

      // Fetch user's rank if address is available
      if (userAddress) {
        const rankData = await getUserLeaderboardRank(userAddress);
        if (rankData) {
          setUserRank(rankData);
        }
      }
    } catch (error) {
      console.error('Error fetching leaderboard:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeaderboard();
    // Refresh every 30 seconds
    const interval = setInterval(fetchLeaderboard, 30000);
    return () => clearInterval(interval);
  }, [userAddress]);

  const handleClaim = async () => {
    if (!userAddress || !userRank?.inTop10) {
      return;
    }

    try {
      setClaiming(true);
      setClaimMessage(null);
      setClaimDetails(null);

      // Try to get Photon user ID (optional - for Google sign-in users)
      // For Petra wallet users, we'll use wallet address as user ID
      const photonUser = await photonService.getCurrentUser();
      const photonUserId = photonUser?.photonUserId || undefined;

      const result = await claimLeaderboardReward(userAddress, photonUserId);
      
      if (result.success) {
        if (result.tokenAmount && result.tokenAmount > 0) {
          setClaimMessage(`✅ Successfully claimed ${result.tokenAmount} PAT tokens!`);
          setClaimDetails({
            tokenAmount: result.tokenAmount,
            photonWalletAddress: result.photonWalletAddress,
            eventId: result.eventId,
          });
        } else {
          // Event tracked but 0 tokens (campaign not configured yet)
          setClaimMessage(`✅ Event tracked successfully! ${result.message || 'Tokens will be awarded once the campaign is configured in Photon.'}`);
          setClaimDetails({
            tokenAmount: 0,
            photonWalletAddress: result.photonWalletAddress,
            eventId: result.eventId,
          });
        }
        // Refresh leaderboard after claim
        await fetchLeaderboard();
      } else {
        setClaimMessage(result.error || 'Failed to claim reward');
        setClaimDetails(null);
      }
    } catch (error: any) {
      console.error('Error claiming reward:', error);
      setClaimMessage(error.message || 'Failed to claim reward');
    } finally {
      setClaiming(false);
    }
  };

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const getRankBadge = (rank: number) => {
    if (rank === 1) return { emoji: '🥇', bg: 'bg-gradient-to-br from-yellow-500/20 to-yellow-600/10', border: 'border-yellow-500/40' };
    if (rank === 2) return { emoji: '🥈', bg: 'bg-gradient-to-br from-gray-300/20 to-gray-400/10', border: 'border-gray-400/40' };
    if (rank === 3) return { emoji: '🥉', bg: 'bg-gradient-to-br from-orange-600/20 to-orange-700/10', border: 'border-orange-600/40' };
    return { emoji: `#${rank}`, bg: 'bg-white/5', border: 'border-white/10' };
  };

  return (
    <div className="min-h-screen bg-cyberpunk-darker py-8 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-4xl font-bold text-white">Daily Leaderboard</h1>
            <button
              onClick={fetchLeaderboard}
              disabled={loading}
              className="px-5 py-2.5 bg-cyberpunk-primary/20 hover:bg-cyberpunk-primary/30 text-cyberpunk-primary font-medium rounded-lg border border-cyberpunk-primary/30 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {loading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
          <p className="text-white/60 text-sm">Top 10 traders compete for daily PAT token rewards</p>
        </div>

        {/* User's Rank Card */}
        {userAddress && userRank && (
          <div className="mb-6 p-5 bg-gradient-to-r from-cyberpunk-primary/10 via-cyberpunk-primary/5 to-transparent border border-cyberpunk-primary/30 rounded-xl backdrop-blur-sm">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-4">
                <div className={`w-16 h-16 rounded-xl flex items-center justify-center text-2xl font-bold border-2 ${
                  userRank.rank ? getRankBadge(userRank.rank).bg : 'bg-white/5'
                } ${userRank.rank ? getRankBadge(userRank.rank).border : 'border-white/10'}`}>
                  {userRank.rank ? getRankBadge(userRank.rank).emoji : '—'}
                </div>
                <div>
                  <p className="text-sm text-cyberpunk-secondary mb-1">Your Position</p>
                  <p className="text-2xl font-bold text-white">
                    {userRank.rank ? `Rank #${userRank.rank}` : 'Not Ranked'}
                  </p>
                  <p className="text-sm text-cyberpunk-secondary mt-1">
                    Score: <span className="text-cyberpunk-primary font-semibold">{userRank.score.toLocaleString()}</span>
                  </p>
                </div>
              </div>
              {userRank.inTop10 && (
                <button
                  onClick={handleClaim}
                  disabled={claiming}
                  className="px-6 py-3 bg-gradient-to-r from-cyberpunk-primary to-cyberpunk-accent text-white font-semibold rounded-lg hover:shadow-lg hover:shadow-cyberpunk-primary/30 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {claiming ? (
                    <>
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Claiming...
                    </>
                  ) : (
                    <>
                      <span>🎁</span>
                      Claim PAT Tokens
                    </>
                  )}
                </button>
              )}
            </div>
            {claimMessage && (
              <div className={`mt-4 p-5 rounded-xl border-2 animate-fade-in ${
                claimMessage.includes('✅') 
                  ? 'bg-gradient-to-br from-green-500/10 to-green-600/5 border-green-500/40 shadow-lg shadow-green-500/20' 
                  : 'bg-red-500/10 border-red-500/30'
              }`}>
                <div className="flex items-start gap-3">
                  <div className={`text-3xl ${claimMessage.includes('✅') ? 'animate-bounce' : ''}`}>
                    {claimMessage.includes('✅') ? '✅' : '❌'}
                  </div>
                  <div className="flex-1">
                    <p className={`text-base font-bold mb-3 ${
                      claimMessage.includes('✅') ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {claimMessage}
                    </p>
                    {claimDetails && (
                      <div className="space-y-3 text-xs border-t border-white/10 pt-3">
                        {claimDetails.tokenAmount > 0 && (
                          <div className="flex items-center gap-3 text-green-300 bg-green-500/10 px-4 py-3 rounded-lg border border-green-500/30">
                            <span className="text-2xl">💰</span>
                            <div>
                              <p className="font-bold text-green-200 text-sm">{claimDetails.tokenAmount} PAT Tokens</p>
                              <p className="text-green-400/70 text-xs mt-0.5">Deposited to your Photon embedded wallet</p>
                            </div>
                          </div>
                        )}
                        {claimDetails.photonWalletAddress && (
                          <div className="bg-white/5 p-4 rounded-lg border border-white/10">
                            <div className="flex items-center gap-2 mb-3">
                              <span className="text-xl">🔷</span>
                              <p className="text-white font-semibold">Photon Embedded Wallet</p>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap mb-2">
                              <code className="px-3 py-2 bg-black/40 rounded-lg font-mono text-xs border border-white/10">
                                {claimDetails.photonWalletAddress.slice(0, 12)}...{claimDetails.photonWalletAddress.slice(-10)}
                              </code>
                              <a
                                href={`https://explorer.aptoslabs.com/account/${claimDetails.photonWalletAddress}?network=${import.meta.env.VITE_APTOS_NETWORK || 'mainnet'}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-3 py-2 bg-cyberpunk-primary/20 hover:bg-cyberpunk-primary/30 text-cyberpunk-primary rounded-lg text-xs transition-all duration-200 inline-flex items-center gap-1.5 hover:scale-105 font-semibold"
                              >
                                <span>View on Explorer</span>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                              </a>
                            </div>
                            <p className="text-white/50 text-xs">
                              💡 Tokens are stored in your Photon embedded wallet. Click "View on Explorer" to see your balance and transaction history.
                            </p>
                          </div>
                        )}
                        {claimDetails.eventId && (
                          <div className="flex items-start gap-2 text-white/50 bg-white/5 px-3 py-2 rounded-lg">
                            <span className="text-lg">📝</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-white/60 text-xs mb-1 font-semibold">Event ID:</p>
                              <code className="font-mono text-xs break-all text-white/70">{claimDetails.eventId}</code>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Leaderboard Cards */}
        {loading && leaderboard.length === 0 ? (
          <div className="text-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-3 border-cyberpunk-primary border-t-transparent mx-auto mb-4"></div>
            <p className="text-white/60">Loading leaderboard...</p>
          </div>
        ) : leaderboard.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">🏆</div>
            <h3 className="text-2xl font-semibold text-white mb-2">No Activity Yet</h3>
            <p className="text-white/60">Be the first to create a duel and climb the leaderboard!</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {leaderboard.map((entry) => {
              const isCurrentUser = userAddress?.toLowerCase() === entry.address.toLowerCase();
              const rankBadge = getRankBadge(entry.rank);
              
              return (
                <div
                  key={entry.address}
                  className={`p-5 rounded-xl border transition-all duration-200 hover:scale-[1.02] ${
                    isCurrentUser
                      ? 'bg-gradient-to-r from-cyberpunk-primary/20 to-cyberpunk-primary/5 border-cyberpunk-primary/50 shadow-lg shadow-cyberpunk-primary/20'
                      : 'bg-white/5 border-white/10 hover:border-cyberpunk-primary/30 hover:bg-white/10'
                  }`}
                >
                  <div className="flex items-center justify-between flex-wrap gap-4">
                    {/* Rank & Address */}
                    <div className="flex items-center gap-4 flex-1 min-w-[200px]">
                      <div className={`w-14 h-14 rounded-lg flex items-center justify-center text-xl font-bold border-2 ${rankBadge.bg} ${rankBadge.border}`}>
                        {rankBadge.emoji}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`font-mono text-sm ${isCurrentUser ? 'text-cyberpunk-primary font-bold' : 'text-white'}`}>
                            {formatAddress(entry.address)}
                          </span>
                          {isCurrentUser && (
                            <span className="px-2 py-0.5 bg-cyberpunk-primary/20 text-cyberpunk-primary text-xs font-semibold rounded border border-cyberpunk-primary/30">
                              YOU
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-xs text-white/50">
                          <span>{entry.duelsCreated + entry.duelsJoined} Duels</span>
                          <span className="text-green-400 font-semibold">{entry.duelsWon} Wins</span>
                        </div>
                      </div>
                    </div>

                    {/* Stats */}
                    <div className="flex items-center gap-6 flex-wrap">
                      <div className="text-center">
                        <p className="text-xs text-white/50 mb-1">Score</p>
                        <p className="text-lg font-bold text-white">{entry.score.toLocaleString()}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-white/50 mb-1">Swaps</p>
                        <p className="text-base font-semibold text-cyberpunk-secondary">{entry.totalSwaps}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-white/50 mb-1">Wagered</p>
                        <p className="text-base font-semibold text-cyberpunk-secondary">{entry.totalWagerAmount.toFixed(2)} APT</p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Scoring Info */}
        <div className="mt-8 p-5 bg-cyberpunk-dark/30 rounded-xl border border-cyberpunk-primary/20 backdrop-blur-sm">
          <div className="flex items-start gap-3 mb-3">
            <div className="text-2xl">📊</div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-cyberpunk-primary mb-2">Scoring Formula</h3>
              <div className="space-y-1 text-xs text-white/70">
                <p>• Duels Created: <span className="text-cyberpunk-primary font-semibold">×10 points</span></p>
                <p>• Duels Joined: <span className="text-cyberpunk-primary font-semibold">×5 points</span></p>
                <p>• Duels Won: <span className="text-cyberpunk-primary font-semibold">×20 points</span></p>
                <p>• Swaps Executed: <span className="text-cyberpunk-primary font-semibold">×1 point</span></p>
                <p>• Total Wagered: <span className="text-cyberpunk-primary font-semibold">+1 point per APT</span></p>
              </div>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-white/10">
            <p className="text-xs text-white/60">
              🎁 Top 10 users at the end of each day (UTC) can claim PAT tokens via Photon rewards. Leaderboard resets daily at midnight UTC.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
