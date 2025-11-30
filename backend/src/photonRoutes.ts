/**
 * Photon API Routes
 * Exposes Photon functionality to the frontend
 */

import express from 'express';
import { onboardUserToPhoton, trackCampaignEvent, generateSimpleJWT } from './photonService.js';

const router = express.Router();

/**
 * Onboard a user to Photon
 * POST /photon/onboard
 * Body: { userId: string, email?: string, name?: string }
 */
router.post('/onboard', async (req, res) => {
  try {
    const { userId, email, name } = req.body;

    if (!userId) {
      return res.status(400).json({ ok: false, error: 'userId is required' });
    }

    // Generate JWT for the user
    const jwtToken = generateSimpleJWT(userId, email, name);

    // Onboard to Photon
    const photonUser = await onboardUserToPhoton(jwtToken, userId);

    if (!photonUser) {
      return res.status(500).json({ ok: false, error: 'Failed to onboard user to Photon' });
    }

    res.json({
      ok: true,
      data: {
        photonUserId: photonUser.id,
        walletAddress: photonUser.walletAddress,
        accessToken: photonUser.accessToken,
        refreshToken: photonUser.refreshToken,
      },
    });
  } catch (error) {
    console.error('Error onboarding user to Photon:', error);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

/**
 * Track a campaign event
 * POST /photon/events
 * Body: { eventId: string, eventType: string, userId: string, metadata?: object, accessToken?: string }
 */
router.post('/events', async (req, res) => {
  try {
    const { eventId, eventType, userId, metadata, accessToken } = req.body;

    if (!eventId || !eventType || !userId) {
      return res.status(400).json({
        ok: false,
        error: 'eventId, eventType, and userId are required',
      });
    }

    const result = await trackCampaignEvent(eventId, eventType, userId, metadata || {}, accessToken);

    if (!result) {
      return res.status(500).json({ ok: false, error: 'Failed to track event' });
    }

    res.json({
      ok: true,
      data: result,
    });
  } catch (error) {
    console.error('Error tracking Photon event:', error);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

export default router;

