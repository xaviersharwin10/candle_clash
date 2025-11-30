/**
 * PhotonService - Frontend service for Photon integration
 * Calls backend API which handles Photon API communication
 */

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';

export interface PhotonUser {
  photonUserId: string;
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

class PhotonService {
  private initialized = false;
  private photonUser: PhotonUser | null = null;

  /**
   * Initialize Photon by onboarding the user
   */
  async init(userId: string, email?: string, name?: string): Promise<PhotonUser | null> {
    if (this.initialized && this.photonUser) {
      return this.photonUser;
    }

    try {
      const response = await fetch(`${BACKEND_URL}/photon/onboard`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          email,
          name,
        }),
      });

      if (!response.ok) {
        console.error('[Photon] Onboarding failed:', await response.text());
        return null;
      }

      const data = await response.json();
      
      if (data.ok && data.data) {
        this.photonUser = data.data;
        this.initialized = true;
        
        // Store in sessionStorage
        sessionStorage.setItem('photon_user', JSON.stringify(this.photonUser));
        
        if (this.photonUser) {
          console.log('[Photon] User onboarded:', this.photonUser.photonUserId);
          return this.photonUser;
        }
      }

      return null;
    } catch (error) {
      console.error('[Photon] Error initializing:', error);
      return null;
    }
  }

  /**
   * Load Photon user from session
   */
  loadFromSession(): PhotonUser | null {
    const stored = sessionStorage.getItem('photon_user');
    if (stored) {
      try {
        this.photonUser = JSON.parse(stored);
        this.initialized = true;
        return this.photonUser;
      } catch (error) {
        console.error('[Photon] Error loading from session:', error);
      }
    }
    return null;
  }

  /**
   * Track a campaign event (rewarded or unrewarded)
   */
  async trackEvent(
    eventId: string,
    eventType: string,
    metadata: Record<string, any> = {}
  ): Promise<PhotonRewardResponse | null> {
    if (!this.photonUser) {
      console.warn('[Photon] User not initialized, cannot track event');
      return null;
    }

    try {
      const response = await fetch(`${BACKEND_URL}/photon/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          eventId,
          eventType,
          userId: this.photonUser.photonUserId,
          metadata,
          accessToken: this.photonUser.accessToken,
        }),
      });

      if (!response.ok) {
        console.error('[Photon] Event tracking failed:', await response.text());
        return null;
      }

      const data = await response.json();
      
      if (data.ok && data.data) {
        console.log(`[Photon] Event tracked: ${eventType}`, data.data);
        return data.data;
      }

      return null;
    } catch (error) {
      console.error('[Photon] Error tracking event:', error);
      return null;
    }
  }

  /**
   * Reward a user for an event (convenience method)
   */
  async reward(eventName: string, payload: Record<string, any> = {}): Promise<void> {
    const eventId = `${eventName}-${Date.now()}`;
    const result = await this.trackEvent(eventId, eventName, payload);
    
    if (result && result.token_amount > 0) {
      console.log(`[Photon] User rewarded ${result.token_amount} ${result.token_symbol} for ${eventName}`);
    }
  }

  /**
   * Track attribution (referral, source, etc.)
   */
  async trackAttribution(source: string, userId: string): Promise<void> {
    await this.trackEvent(
      `attribution-${Date.now()}`,
      'referral_signup',
      { source, referred_user_id: userId }
    );
  }

  /**
   * Get user's Photon wallet address
   */
  getWalletAddress(): string | null {
    return this.photonUser?.walletAddress || null;
  }

  /**
   * Get Photon user ID
   */
  getUserId(): string | null {
    return this.photonUser?.photonUserId || null;
  }

  /**
   * Get current Photon user (for leaderboard claims)
   */
  async getCurrentUser(): Promise<PhotonUser | null> {
    // Try to load from session first
    if (!this.photonUser) {
      this.loadFromSession();
    }
    return this.photonUser;
  }

  /**
   * Clear Photon session (for logout/wallet switch)
   */
  clearSession(): void {
    this.photonUser = null;
    this.initialized = false;
    sessionStorage.removeItem('photon_user');
  }
}

// Singleton instance
export const photonService = new PhotonService();

// Event types for Candle Clash
export const PhotonEvents = {
  DUEL_CREATED: 'duel_created',
  DUEL_JOINED: 'duel_joined',
  DUEL_WATCHED: 'duel_watched',
  DUEL_WON: 'duel_won',
  DUEL_LOST: 'duel_lost',
  DUEL_SHARED: 'duel_shared',
  DAILY_LOGIN: 'daily_login',
  REFERRAL_SIGNUP: 'referral_signup',
  CLEANUP_BADGE: 'cleanup_badge',
} as const;
