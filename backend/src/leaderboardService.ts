/**
 * Leaderboard Service
 * Tracks user activity for daily leaderboard calculation
 * Uses off-chain tracking (no contract changes needed)
 */

import { trackCampaignEvent, getOrOnboardPhotonUser } from './photonService.js';

export interface UserActivity {
  address: string;
  duelsCreated: number;
  duelsJoined: number;
  duelsWon: number;
  totalSwaps: number;
  totalWagerAmount: number; // in octas (will convert to APT for scoring)
  lastActivityTimestamp: number;
}

export interface LeaderboardEntry {
  rank: number;
  address: string;
  score: number;
  duelsCreated: number;
  duelsJoined: number;
  duelsWon: number;
  totalSwaps: number;
  totalWagerAmount: number; // in APT
}

// In-memory store for user activity
// In production, use a database (PostgreSQL, MongoDB, etc.)
const userActivity: Map<string, UserActivity> = new Map();

// Track daily reset (midnight UTC)
let lastResetDate: string = getCurrentDateUTC();

/**
 * Get current date in UTC (YYYY-MM-DD format)
 */
function getCurrentDateUTC(): string {
  const now = new Date();
  return now.toISOString().split('T')[0]; // Returns YYYY-MM-DD
}

/**
 * Reset daily leaderboard at midnight UTC
 */
function checkAndResetDaily(): void {
  const currentDate = getCurrentDateUTC();
  if (currentDate !== lastResetDate) {
    console.log(`[Leaderboard] Daily reset: ${lastResetDate} -> ${currentDate}`);
    // Clear all activity for new day
    userActivity.clear();
    lastResetDate = currentDate;
  }
}

/**
 * Get or create user activity record
 */
function getUserActivity(address: string): UserActivity {
  const normalizedAddress = address.toLowerCase();
  
  if (!userActivity.has(normalizedAddress)) {
    userActivity.set(normalizedAddress, {
      address: normalizedAddress,
      duelsCreated: 0,
      duelsJoined: 0,
      duelsWon: 0,
      totalSwaps: 0,
      totalWagerAmount: 0,
      lastActivityTimestamp: 0,
    });
  }
  
  return userActivity.get(normalizedAddress)!;
}

/**
 * Calculate leaderboard score for a user
 * Formula: (duels_created * 10) + (duels_joined * 5) + (duels_won * 20) + (swaps * 1) + (wager_APT)
 */
function calculateScore(activity: UserActivity): number {
  const wagerAPT = activity.totalWagerAmount / 1_000_000_000; // Convert octas to APT
  const score = 
    (activity.duelsCreated * 10) +
    (activity.duelsJoined * 5) +
    (activity.duelsWon * 20) +
    activity.totalSwaps +
    wagerAPT;
  return Math.floor(score);
}

/**
 * Track duel created event
 */
export function trackDuelCreated(playerAddress: string, wagerAmount: number): void {
  checkAndResetDaily();
  const activity = getUserActivity(playerAddress);
  activity.duelsCreated += 1;
  activity.totalWagerAmount += wagerAmount;
  activity.lastActivityTimestamp = Math.floor(Date.now() / 1000);
  console.log(`[Leaderboard] Duel created: ${playerAddress}, total created: ${activity.duelsCreated}`);
}

/**
 * Track duel joined event
 */
export function trackDuelJoined(playerAddress: string, wagerAmount: number): void {
  checkAndResetDaily();
  const activity = getUserActivity(playerAddress);
  activity.duelsJoined += 1;
  activity.totalWagerAmount += wagerAmount;
  activity.lastActivityTimestamp = Math.floor(Date.now() / 1000);
  console.log(`[Leaderboard] Duel joined: ${playerAddress}, total joined: ${activity.duelsJoined}`);
}

/**
 * Track duel won event
 */
export function trackDuelWon(playerAddress: string): void {
  checkAndResetDaily();
  const activity = getUserActivity(playerAddress);
  activity.duelsWon += 1;
  activity.lastActivityTimestamp = Math.floor(Date.now() / 1000);
  console.log(`[Leaderboard] Duel won: ${playerAddress}, total won: ${activity.duelsWon}`);
}

/**
 * Track swap executed (reported from frontend)
 */
export function trackSwapExecuted(playerAddress: string, duelId: number): void {
  checkAndResetDaily();
  const activity = getUserActivity(playerAddress);
  activity.totalSwaps += 1;
  activity.lastActivityTimestamp = Math.floor(Date.now() / 1000);
  console.log(`[Leaderboard] Swap executed: ${playerAddress} in duel ${duelId}, total swaps: ${activity.totalSwaps}`);
}

/**
 * Get daily leaderboard (top N users)
 */
export function getDailyLeaderboard(limit: number = 10): LeaderboardEntry[] {
  checkAndResetDaily();
  
  const entries: LeaderboardEntry[] = [];
  
  for (const [address, activity] of userActivity.entries()) {
    const score = calculateScore(activity);
    entries.push({
      rank: 0, // Will be set after sorting
      address: activity.address,
      score,
      duelsCreated: activity.duelsCreated,
      duelsJoined: activity.duelsJoined,
      duelsWon: activity.duelsWon,
      totalSwaps: activity.totalSwaps,
      totalWagerAmount: activity.totalWagerAmount / 1_000_000_000, // Convert to APT
    });
  }
  
  // Sort by score (descending)
  entries.sort((a, b) => b.score - a.score);
  
  // Assign ranks
  entries.forEach((entry, index) => {
    entry.rank = index + 1;
  });
  
  // Return top N
  return entries.slice(0, limit);
}

/**
 * Check if user is in top 10 of daily leaderboard
 */
export function isUserInTop10(userAddress: string): boolean {
  const leaderboard = getDailyLeaderboard(10);
  const normalizedAddress = userAddress.toLowerCase();
  return leaderboard.some(entry => entry.address.toLowerCase() === normalizedAddress);
}

/**
 * Get user's current rank and score
 */
export function getUserRank(userAddress: string): { rank: number | null; score: number; entry: LeaderboardEntry | null } {
  const leaderboard = getDailyLeaderboard(100); // Get more entries to find user
  const normalizedAddress = userAddress.toLowerCase();
  const userEntry = leaderboard.find(entry => entry.address.toLowerCase() === normalizedAddress);
  
  if (userEntry) {
    return {
      rank: userEntry.rank,
      score: userEntry.score,
      entry: userEntry,
    };
  }
  
  // User not in leaderboard
  const activity = getUserActivity(userAddress);
  return {
    rank: null,
    score: calculateScore(activity),
    entry: null,
  };
}

/**
 * Claim PAT tokens for top 10 users (calls Photon API)
 * If photonUserId is not provided, uses wallet address as user ID
 */
export async function claimLeaderboardReward(
  userAddress: string,
  photonUserId?: string
): Promise<{ success: boolean; tokenAmount?: number; error?: string; message?: string; photonWalletAddress?: string; photonUserId?: string; eventId?: string }> {
  checkAndResetDaily();
  
  if (!isUserInTop10(userAddress)) {
    return {
      success: false,
      error: 'User is not in top 10 of daily leaderboard',
    };
  }
  
  const userRank = getUserRank(userAddress);
  if (!userRank.rank || userRank.rank > 10) {
    return {
      success: false,
      error: 'User is not in top 10',
    };
  }
  
  // Calculate reward based on rank (more tokens for higher ranks)
  // Rank 1: 100 PAT, Rank 2: 90 PAT, ..., Rank 10: 10 PAT
  const tokenAmount = (11 - userRank.rank) * 10;
  
  try {
    // Get or onboard Photon user (required for campaign events)
    let photonUser;
    if (photonUserId) {
      // If Photon user ID is provided, use it directly
      // But we still need to get the access token, so try to get from cache or onboard
      photonUser = await getOrOnboardPhotonUser(userAddress);
    } else {
      // Onboard user if not already onboarded
      photonUser = await getOrOnboardPhotonUser(userAddress);
    }
    
    if (!photonUser) {
      console.error(`[Leaderboard] Failed to onboard/get Photon user for ${userAddress}`);
      return {
        success: false,
        error: 'Failed to initialize Photon account. Please try again.',
      };
    }
    
    // Call Photon API to reward user using Photon user ID (UUID)
    // Using 'game_win' event type as it's likely already configured in the campaign
    // For production, configure 'leaderboard_reward' event type in Photon dashboard
    const result = await trackCampaignEvent(
      `leaderboard_reward-${getCurrentDateUTC()}-${userAddress}-${Date.now()}`,
      'game_win', // Using 'game_win' as it's likely configured. Change to 'leaderboard_reward' once configured in Photon dashboard
      photonUser.id, // Use Photon user ID (UUID), not wallet address
      {
        rank: userRank.rank,
        score: userRank.score,
        date: getCurrentDateUTC(),
        walletAddress: userAddress,
      },
      photonUser.accessToken // Include access token for authentication
    );
    
    if (result && result.token_amount !== undefined) {
      const actualTokenAmount = result.token_amount;
      console.log(`[Leaderboard] Photon API response: ${actualTokenAmount} PAT tokens for ${photonUser.id} (${userAddress}) at rank ${userRank.rank}`);
      
      if (actualTokenAmount > 0) {
        return {
          success: true,
          tokenAmount: actualTokenAmount,
          photonWalletAddress: photonUser.walletAddress,
          photonUserId: photonUser.id,
          eventId: result.event_id || `leaderboard_reward-${getCurrentDateUTC()}-${userAddress}-${Date.now()}`,
        };
      } else {
        // Campaign returned 0 tokens - this means the event was tracked but not rewarded
        // For demo purposes, we'll still show success but indicate it's pending campaign configuration
        console.warn(`[Leaderboard] Photon returned 0 tokens. Event tracked successfully, but campaign needs configuration for rewards.`);
        return {
          success: true,
          tokenAmount: 0,
          message: 'Event tracked successfully! Tokens will be awarded once the campaign is configured in Photon.',
        };
      }
    }
    
    console.error(`[Leaderboard] Photon API did not return valid response`);
    return {
      success: false,
      error: 'Photon API did not return a valid response. Please try again later.',
    };
  } catch (error: any) {
    console.error('[Leaderboard] Error claiming reward:', error);
    return {
      success: false,
      error: error.message || 'Failed to claim reward. Please try again later.',
    };
  }
}

