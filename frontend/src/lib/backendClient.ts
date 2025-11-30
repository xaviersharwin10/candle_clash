const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';

/**
 * Report P&L to backend referee service
 */
export async function reportPnL(
  duelId: number,
  playerAddress: string,
  pnlPercent: number
): Promise<boolean> {
  try {
    const response = await fetch(`${BACKEND_URL}/duels/${duelId}/report-pnl`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        playerAddress,
        pnlPercent,
      }),
    });

    const data = await response.json();
    return data.ok === true;
  } catch (error) {
    console.error('Error reporting P&L:', error);
    return false;
  }
}

/**
 * Check backend health
 */
export async function checkBackendHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${BACKEND_URL}/health`);
    const data = await response.json();
    return data.ok === true;
  } catch (error) {
    return false;
  }
}

/**
 * Report swap executed for leaderboard tracking
 */
export async function reportSwapExecuted(
  playerAddress: string,
  duelId: number
): Promise<boolean> {
  try {
    const response = await fetch(`${BACKEND_URL}/leaderboard/report-swap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        playerAddress,
        duelId,
      }),
    });

    const data = await response.json();
    return data.ok === true;
  } catch (error) {
    console.error('Error reporting swap:', error);
    return false;
  }
}

/**
 * Report duel created for leaderboard tracking
 */
export async function reportDuelCreated(
  playerAddress: string,
  wagerAmount: number
): Promise<boolean> {
  try {
    const response = await fetch(`${BACKEND_URL}/leaderboard/report-duel-created`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        playerAddress,
        wagerAmount,
      }),
    });

    const data = await response.json();
    return data.ok === true;
  } catch (error) {
    console.error('Error reporting duel created:', error);
    return false;
  }
}

/**
 * Report duel joined for leaderboard tracking
 */
export async function reportDuelJoined(
  playerAddress: string,
  wagerAmount: number
): Promise<boolean> {
  try {
    const response = await fetch(`${BACKEND_URL}/leaderboard/report-duel-joined`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        playerAddress,
        wagerAmount,
      }),
    });

    const data = await response.json();
    return data.ok === true;
  } catch (error) {
    console.error('Error reporting duel joined:', error);
    return false;
  }
}

/**
 * Get daily leaderboard
 */
export async function getLeaderboard(limit: number = 10): Promise<{
  leaderboard: Array<{
    rank: number;
    address: string;
    score: number;
    duelsCreated: number;
    duelsJoined: number;
    duelsWon: number;
    totalSwaps: number;
    totalWagerAmount: number;
  }>;
  date: string;
} | null> {
  try {
    const response = await fetch(`${BACKEND_URL}/leaderboard?limit=${limit}`);
    const data = await response.json();
    
    if (data.ok && data.data) {
      return data.data;
    }
    return null;
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    return null;
  }
}

/**
 * Get user's leaderboard rank
 */
export async function getUserLeaderboardRank(userAddress: string): Promise<{
  rank: number | null;
  score: number;
  inTop10: boolean;
  entry: {
    rank: number;
    address: string;
    score: number;
    duelsCreated: number;
    duelsJoined: number;
    duelsWon: number;
    totalSwaps: number;
    totalWagerAmount: number;
  } | null;
} | null> {
  try {
    const response = await fetch(`${BACKEND_URL}/leaderboard/user/${userAddress}`);
    const data = await response.json();
    
    if (data.ok && data.data) {
      return data.data;
    }
    return null;
  } catch (error) {
    console.error('Error fetching user rank:', error);
    return null;
  }
}

/**
 * Claim leaderboard reward (PAT tokens via Photon)
 * photonUserId is optional - if not provided, uses wallet address
 */
export async function claimLeaderboardReward(
  userAddress: string,
  photonUserId?: string
): Promise<{ success: boolean; tokenAmount?: number; error?: string; message?: string; photonWalletAddress?: string; photonUserId?: string; eventId?: string }> {
  try {
    const response = await fetch(`${BACKEND_URL}/leaderboard/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userAddress,
        photonUserId,
      }),
    });

    const data = await response.json();
    
    if (data.ok && data.data) {
      return {
        success: true,
        tokenAmount: data.data.tokenAmount,
        message: data.data.message,
        photonWalletAddress: data.data.photonWalletAddress,
        photonUserId: data.data.photonUserId,
        eventId: data.data.eventId,
      };
    }
    
    return {
      success: false,
      error: data.error || 'Failed to claim reward',
    };
  } catch (error: any) {
    console.error('Error claiming leaderboard reward:', error);
    return {
      success: false,
      error: error.message || 'Failed to claim reward',
    };
  }
}
