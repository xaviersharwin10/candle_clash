/**
 * Photon API Service
 * Handles all Photon API calls from the backend
 */

import jwt from 'jsonwebtoken';
import { createRequire } from 'module';

// For ES modules compatibility with CommonJS jsonwebtoken
const require = createRequire(import.meta.url);
const jwtModule = require('jsonwebtoken');

const PHOTON_BASE_URL = 'https://stage-api.getstan.app/identity-service/api/v1';
const PHOTON_API_KEY = process.env.PHOTON_API_KEY || '7bc5d06eb53ad73716104742c7e8a5377da9fe8156378dcfebfb8253da4e8800';
const PHOTON_CAMPAIGN_ID = process.env.PHOTON_CAMPAIGN_ID || 'ea3bcaca-9ce4-4b54-b803-8b9be1f142ba';
const JWT_SECRET = process.env.JWT_SECRET || 'candle-clash-mvp-secret-key-change-in-production';

// In-memory cache for Photon user IDs (wallet address -> Photon user ID)
// In production, use a database
const photonUserCache: Map<string, PhotonUser> = new Map();

// Log initialization
console.log('[Photon] ===== Photon Service Initialized =====');
console.log('[Photon] Base URL:', PHOTON_BASE_URL);
console.log('[Photon] API Key (first 20 chars):', PHOTON_API_KEY.substring(0, 20) + '...');
console.log('[Photon] Campaign ID:', PHOTON_CAMPAIGN_ID);
console.log('[Photon] JWT Secret (first 10 chars):', JWT_SECRET.substring(0, 10) + '...');
console.log('[Photon] User cache initialized (size:', photonUserCache.size, ')');
console.log('[Photon] =======================================');

export interface PhotonUser {
  id: string;
  walletAddress: string;
  accessToken: string;
  refreshToken: string;
}

export interface PhotonRewardResponse {
  success: boolean;
  event_id: string;
  token_amount: number;
  token_symbol: string;
  campaign_id: string;
}

/**
 * Onboard a user to Photon using a JWT token
 * This creates a Photon identity and embedded wallet for the user
 */
export async function onboardUserToPhoton(
  jwtToken: string,
  clientUserId: string
): Promise<PhotonUser | null> {
  console.log('[Photon] ===== Starting user onboarding =====');
  console.log('[Photon] Client User ID:', clientUserId);
  console.log('[Photon] JWT Token (first 50 chars):', jwtToken.substring(0, 50) + '...');
  console.log('[Photon] API URL:', `${PHOTON_BASE_URL}/identity/register`);
  
  try {
    const requestBody = {
      provider: 'jwt',
      data: {
        token: jwtToken,
        client_user_id: clientUserId,
      },
    };
    
    console.log('[Photon] Request body:', JSON.stringify({
      ...requestBody,
      data: { ...requestBody.data, token: '[REDACTED]' }
    }, null, 2));
    
    const response = await fetch(`${PHOTON_BASE_URL}/identity/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': PHOTON_API_KEY,
      },
      body: JSON.stringify(requestBody),
    });

    console.log('[Photon] Response status:', response.status, response.statusText);
    console.log('[Photon] Response headers:', Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Photon] ❌ Onboarding failed - HTTP Error');
      console.error('[Photon] Error response:', errorText);
      return null;
    }

    const data = await response.json();
    console.log('[Photon] Response data:', JSON.stringify(data, null, 2));
    
    if (data.success && data.data) {
      const photonUser = {
        id: data.data.user.user.id,
        walletAddress: data.data.wallet.walletAddress,
        accessToken: data.data.tokens.access_token,
        refreshToken: data.data.tokens.refresh_token,
      };
      
      console.log('[Photon] ✅ Onboarding successful!');
      console.log('[Photon] Photon User ID:', photonUser.id);
      console.log('[Photon] Wallet Address:', photonUser.walletAddress);
      console.log('[Photon] Access Token (first 30 chars):', photonUser.accessToken.substring(0, 30) + '...');
      console.log('[Photon] ===== Onboarding complete =====');
      
      return photonUser;
    }

    console.warn('[Photon] ⚠️ Response success but data structure unexpected');
    console.warn('[Photon] Data:', JSON.stringify(data, null, 2));
    return null;
  } catch (error) {
    console.error('[Photon] ❌ Exception during onboarding:', error);
    if (error instanceof Error) {
      console.error('[Photon] Error message:', error.message);
      console.error('[Photon] Error stack:', error.stack);
    }
    return null;
  }
}

/**
 * Track a campaign event (rewarded or unrewarded)
 * Rewarded events mint PAT tokens, unrewarded events just track activity
 */
export async function trackCampaignEvent(
  eventId: string,
  eventType: string,
  userId: string,
  metadata: Record<string, any> = {},
  accessToken?: string
): Promise<PhotonRewardResponse | null> {
  console.log('[Photon] ===== Tracking campaign event =====');
  console.log('[Photon] Event ID:', eventId);
  console.log('[Photon] Event Type:', eventType);
  console.log('[Photon] User ID:', userId);
  console.log('[Photon] Campaign ID:', PHOTON_CAMPAIGN_ID);
  console.log('[Photon] Metadata:', JSON.stringify(metadata, null, 2));
  console.log('[Photon] Has Access Token:', !!accessToken);
  if (accessToken) {
    console.log('[Photon] Access Token (first 30 chars):', accessToken.substring(0, 30) + '...');
  }
  
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Api-Key': PHOTON_API_KEY,
    };

    // Add Authorization header if access token is provided
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
      console.log('[Photon] Added Authorization header with Bearer token');
    }

    const requestBody = {
      event_id: eventId,
      event_type: eventType,
      user_id: userId,
      campaign_id: PHOTON_CAMPAIGN_ID,
      metadata,
      timestamp: new Date().toISOString(),
    };
    
    console.log('[Photon] Request URL:', `${PHOTON_BASE_URL}/attribution/events/campaign`);
    console.log('[Photon] Request body:', JSON.stringify(requestBody, null, 2));
    console.log('[Photon] Request headers:', JSON.stringify({
      ...headers,
      'X-Api-Key': '[REDACTED]',
      'Authorization': headers['Authorization'] ? '[REDACTED]' : undefined
    }, null, 2));

    const response = await fetch(`${PHOTON_BASE_URL}/attribution/events/campaign`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    console.log('[Photon] Response status:', response.status, response.statusText);
    console.log('[Photon] Response headers:', Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Photon] ❌ Campaign event failed - HTTP Error');
      console.error('[Photon] Error response:', errorText);
      return null;
    }

    const data = await response.json();
    console.log('[Photon] ✅ Campaign event response received');
    console.log('[Photon] Full response:', JSON.stringify(data, null, 2));
    
    if (data.success && data.data) {
      // Response structure: { success: true, data: { success: true, event_id, token_amount, ... } }
      const result = data.data;
      console.log('[Photon] ✅ Event tracked successfully!');
      console.log('[Photon] Event ID:', result.event_id);
      console.log('[Photon] Token Amount:', result.token_amount);
      console.log('[Photon] Token Symbol:', result.token_symbol);
      console.log('[Photon] Campaign ID:', result.campaign_id);
      console.log('[Photon] ===== Campaign event complete =====');
      return result;
    }

    console.error('[Photon] ❌ Invalid response structure');
    console.error('[Photon] Expected: { success: true, data: { ... } }');
    console.error('[Photon] Received:', JSON.stringify(data, null, 2));
    return null;
  } catch (error) {
    console.error('[Photon] ❌ Exception during campaign event tracking');
    if (error instanceof Error) {
      console.error('[Photon] Error message:', error.message);
      console.error('[Photon] Error stack:', error.stack);
    } else {
      console.error('[Photon] Error object:', error);
    }
    return null;
  }
}

/**
 * Generate a JWT for user onboarding
 * Uses jsonwebtoken library for proper signing
 */
export function generateSimpleJWT(userId: string, email?: string, name?: string): string {
  console.log('[Photon] ===== Generating JWT token =====');
  console.log('[Photon] User ID:', userId);
  console.log('[Photon] Email:', email || `${userId}@candle-clash.local`);
  console.log('[Photon] Name:', name || `User ${userId.slice(0, 8)}`);
  
  const payload = {
    sub: userId,
    user_id: userId,
    email: email || `${userId}@candle-clash.local`,
    name: name || `User ${userId.slice(0, 8)}`,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
  };

  console.log('[Photon] JWT Payload:', JSON.stringify(payload, null, 2));
  console.log('[Photon] JWT Secret (first 10 chars):', JWT_SECRET.substring(0, 10) + '...');

  // Sign JWT with secret
  // Use require for CommonJS compatibility in ES modules
  const token = jwtModule.sign(payload, JWT_SECRET, { algorithm: 'HS256' });
  
  console.log('[Photon] ✅ JWT token generated');
  console.log('[Photon] Token (first 50 chars):', token.substring(0, 50) + '...');
  console.log('[Photon] Token length:', token.length);
  console.log('[Photon] ===== JWT generation complete =====');
  
  return token;
}

/**
 * Get or onboard a Photon user for a wallet address
 * This ensures users are onboarded before tracking events
 */
export async function getOrOnboardPhotonUser(walletAddress: string): Promise<PhotonUser | null> {
  console.log('[Photon] ===== getOrOnboardPhotonUser =====');
  console.log('[Photon] Input wallet address:', walletAddress);
  
  const normalizedAddress = walletAddress.toLowerCase();
  console.log('[Photon] Normalized address:', normalizedAddress);
  
  // Check cache first
  if (photonUserCache.has(normalizedAddress)) {
    const cachedUser = photonUserCache.get(normalizedAddress)!;
    console.log('[Photon] ✅ Found cached Photon user');
    console.log('[Photon] Cached Photon User ID:', cachedUser.id);
    console.log('[Photon] Cached Wallet Address:', cachedUser.walletAddress);
    console.log('[Photon] ===== Returning cached user =====');
    return cachedUser;
  }
  
  console.log('[Photon] ⚠️ User not in cache, need to onboard');
  console.log('[Photon] Cache size:', photonUserCache.size);
  console.log('[Photon] Cached addresses:', Array.from(photonUserCache.keys()));
  
  // Onboard user to Photon
  console.log(`[Photon] Starting onboarding process for wallet: ${normalizedAddress}`);
  const jwtToken = generateSimpleJWT(normalizedAddress, undefined, `User ${normalizedAddress.slice(0, 8)}`);
  const photonUser = await onboardUserToPhoton(jwtToken, normalizedAddress);
  
  if (photonUser) {
    // Cache the user
    photonUserCache.set(normalizedAddress, photonUser);
    console.log(`[Photon] ✅ User onboarded and cached successfully`);
    console.log(`[Photon] Photon User ID: ${photonUser.id}`);
    console.log(`[Photon] Photon Wallet: ${photonUser.walletAddress}`);
    console.log('[Photon] Cache updated. New cache size:', photonUserCache.size);
    console.log('[Photon] ===== Onboarding complete =====');
    return photonUser;
  }
  
  console.error(`[Photon] ❌ Failed to onboard user: ${normalizedAddress}`);
  console.error('[Photon] ===== Onboarding failed =====');
  return null;
}

