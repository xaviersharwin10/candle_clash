/**
 * Leaderboard API Routes
 */

import express from 'express';
import {
  trackSwapExecuted,
  getDailyLeaderboard,
  getUserRank,
  claimLeaderboardReward,
  isUserInTop10,
} from './leaderboardService.js';

const router = express.Router();

/**
 * GET /leaderboard
 * Get daily leaderboard (top 10 by default)
 */
router.get('/', (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const leaderboard = getDailyLeaderboard(limit);
    
    res.json({
      ok: true,
      data: {
        leaderboard,
        date: new Date().toISOString().split('T')[0], // Current date in UTC
      },
    });
  } catch (error: any) {
    console.error('[Leaderboard] Error fetching leaderboard:', error);
    res.status(500).json({
      ok: false,
      error: error.message || 'Failed to fetch leaderboard',
    });
  }
});

/**
 * GET /leaderboard/user/:address
 * Get user's rank and score
 */
router.get('/user/:address', (req, res) => {
  try {
    const address = req.params.address;
    const userRank = getUserRank(address);
    const inTop10 = isUserInTop10(address);
    
    res.json({
      ok: true,
      data: {
        ...userRank,
        inTop10,
      },
    });
  } catch (error: any) {
    console.error('[Leaderboard] Error fetching user rank:', error);
    res.status(500).json({
      ok: false,
      error: error.message || 'Failed to fetch user rank',
    });
  }
});

/**
 * POST /leaderboard/report-swap
 * Report a swap executed by a user (called from frontend after Liquidswap swap)
 */
router.post('/report-swap', (req, res) => {
  try {
    const { playerAddress, duelId } = req.body;
    
    if (!playerAddress || typeof duelId !== 'number') {
      return res.status(400).json({
        ok: false,
        error: 'Invalid payload: playerAddress and duelId required',
      });
    }
    
    trackSwapExecuted(playerAddress, duelId);
    
    res.json({
      ok: true,
      message: 'Swap tracked successfully',
    });
  } catch (error: any) {
    console.error('[Leaderboard] Error reporting swap:', error);
    res.status(500).json({
      ok: false,
      error: error.message || 'Failed to report swap',
    });
  }
});

/**
 * POST /leaderboard/report-duel-created
 * Report a duel created (called from frontend after create_duel transaction)
 */
router.post('/report-duel-created', (req, res) => {
  try {
    const { playerAddress, wagerAmount } = req.body;
    
    if (!playerAddress || typeof wagerAmount !== 'number') {
      return res.status(400).json({
        ok: false,
        error: 'Invalid payload: playerAddress and wagerAmount required',
      });
    }
    
    trackDuelCreated(playerAddress, Math.floor(wagerAmount * 1_000_000_000)); // Convert APT to octas
    
    res.json({
      ok: true,
      message: 'Duel created tracked successfully',
    });
  } catch (error: any) {
    console.error('[Leaderboard] Error reporting duel created:', error);
    res.status(500).json({
      ok: false,
      error: error.message || 'Failed to report duel created',
    });
  }
});

/**
 * POST /leaderboard/report-duel-joined
 * Report a duel joined (called from frontend after join_duel transaction)
 */
router.post('/report-duel-joined', (req, res) => {
  try {
    const { playerAddress, wagerAmount } = req.body;
    
    if (!playerAddress || typeof wagerAmount !== 'number') {
      return res.status(400).json({
        ok: false,
        error: 'Invalid payload: playerAddress and wagerAmount required',
      });
    }
    
    trackDuelJoined(playerAddress, Math.floor(wagerAmount * 1_000_000_000)); // Convert APT to octas
    
    res.json({
      ok: true,
      message: 'Duel joined tracked successfully',
    });
  } catch (error: any) {
    console.error('[Leaderboard] Error reporting duel joined:', error);
    res.status(500).json({
      ok: false,
      error: error.message || 'Failed to report duel joined',
    });
  }
});

/**
 * POST /leaderboard/claim
 * Claim PAT tokens for top 10 users (calls Photon API)
 * photonUserId is optional - if not provided, uses wallet address
 */
router.post('/claim', async (req, res) => {
  try {
    const { userAddress, photonUserId } = req.body;
    
    if (!userAddress) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid payload: userAddress is required',
      });
    }
    
    const result = await claimLeaderboardReward(userAddress, photonUserId);
    
    if (result.success) {
      const message = result.tokenAmount && result.tokenAmount > 0
        ? `Successfully claimed ${result.tokenAmount} PAT tokens!`
        : result.message || 'Event tracked successfully! Tokens will be awarded once the campaign is configured.';
      
      res.json({
        ok: true,
        data: {
          tokenAmount: result.tokenAmount || 0,
          message: message,
          photonWalletAddress: result.photonWalletAddress,
          photonUserId: result.photonUserId,
          eventId: result.eventId,
        },
      });
    } else {
      res.status(400).json({
        ok: false,
        error: result.error || 'Failed to claim reward',
      });
    }
  } catch (error: any) {
    console.error('[Leaderboard] Error claiming reward:', error);
    res.status(500).json({
      ok: false,
      error: error.message || 'Failed to claim reward',
    });
  }
});

export default router;

