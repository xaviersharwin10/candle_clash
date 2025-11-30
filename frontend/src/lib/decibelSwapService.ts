/**
 * Decibel Swap Service
 * 
 * This service mocks Decibel swaps for hackathon demo purposes.
 * It properly tracks all swaps and calculates P&L from trade history.
 * 
 * Structure is designed to be easily swapped with real Decibel API later.
 */

export interface SwapToken {
  symbol: string;
  name: string;
  address: string; // Token address on Aptos
  decimals: number;
}

export interface Swap {
  id: string;
  duelId: number;
  playerAddress: string;
  timestamp: number; // Unix timestamp in seconds
  tokenIn: SwapToken;
  tokenOut: SwapToken;
  amountIn: number; // Amount in tokenIn's base units
  amountOut: number; // Amount in tokenOut's base units
  priceInUSD: number; // Price of tokenIn at swap time
  priceOutUSD: number; // Price of tokenOut at swap time
  valueInUSD: number; // amountIn * priceInUSD
  valueOutUSD: number; // amountOut * priceOutUSD
  pnlUSD: number; // valueOutUSD - valueInUSD (for this swap)
}

export interface SwapPosition {
  token: SwapToken;
  amount: number; // Amount held in base units
  avgEntryPrice: number; // Average entry price in USD
  totalCostUSD: number; // Total cost basis in USD
}

export interface PlayerSwapState {
  playerAddress: string;
  initialBalanceUSD: number; // Starting balance in USD (from wager)
  currentPositions: Map<string, SwapPosition>; // token address -> position
  swapHistory: Swap[]; // All swaps made during duel
  totalPnLUSD: number; // Cumulative P&L from all swaps
  pnlPercent: number; // (totalPnLUSD / initialBalanceUSD) * 100
}

// Supported trading pairs (3-4 assets as requested)
export const SUPPORTED_TOKENS: SwapToken[] = [
  {
    symbol: 'APT',
    name: 'Aptos',
    address: '0x1::aptos_coin::AptosCoin',
    decimals: 8,
  },
  {
    symbol: 'zUSDC',
    name: 'USD Coin',
    address: '0xf22bede237a07e121b56d91a491eb7bcdfd1f5907926a9e58338f964a01b17fa::asset::USDC', // Mainnet USDC
    decimals: 6,
  },
  {
    symbol: 'BTC',
    name: 'Bitcoin',
    address: '0x1::bitcoin::BTC', // Mock address
    decimals: 8,
  },
  {
    symbol: 'ETH',
    name: 'Ethereum',
    address: '0x1::ethereum::ETH', // Mock address
    decimals: 18,
  },
];

// Mock price feed (in production, fetch from CoinGecko or Decibel API)
const MOCK_PRICES: Record<string, number> = {
  'APT': 8.50,
  'zUSDC': 1.00,
  'BTC': 45000.00,
  'ETH': 2800.00,
};

// Price volatility for realistic price movement
const PRICE_VOLATILITY = 0.02; // 2% max change per update

/**
 * Get current price for a token (with some volatility for realism)
 */
export function getCurrentPrice(tokenSymbol: string): number {
  const basePrice = MOCK_PRICES[tokenSymbol] || 1.0;
  const volatility = (Math.random() - 0.5) * 2 * PRICE_VOLATILITY; // -2% to +2%
  return basePrice * (1 + volatility);
}

/**
 * Get price for a token at a specific time (for historical swaps)
 * In production, this would fetch from price oracle
 */
export function getPriceAtTime(tokenSymbol: string, timestamp: number): number {
  // For now, use current price with some historical variation
  const basePrice = MOCK_PRICES[tokenSymbol] || 1.0;
  const timeVariation = Math.sin(timestamp / 1000) * 0.01; // Small variation based on time
  return basePrice * (1 + timeVariation);
}

/**
 * Calculate swap output amount (with 0.3% fee like Uniswap)
 */
export function calculateSwapOutput(
  amountIn: number,
  priceIn: number,
  priceOut: number,
  feeBps: number = 30 // 0.3% = 30 basis points
): number {
  const valueInUSD = amountIn * priceIn;
  const feeUSD = valueInUSD * (feeBps / 10000);
  const valueOutUSD = valueInUSD - feeUSD;
  return valueOutUSD / priceOut;
}

/**
 * Decibel Swap Service Class
 * Tracks swaps and calculates P&L for each player in a duel
 */
export class DecibelSwapService {
  private playerStates: Map<string, PlayerSwapState> = new Map();
  private swapHistory: Swap[] = [];
  private priceUpdateInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Initialize a player's swap state for a duel
   * Takes a snapshot of wallet balance at duel start and normalizes to USDC
   * @param initialBalanceUSD - Starting balance in USD (from wager or wallet)
   * @param initialAptBalance - Optional: Actual APT balance from wallet (in APT, not base units)
   */
  initializePlayer(
    duelId: number,
    playerAddress: string,
    initialBalanceUSD: number,
    initialAptBalance?: number // Optional: actual APT balance from wallet (in APT, not base units)
  ): void {
    const state: PlayerSwapState = {
      playerAddress,
      initialBalanceUSD,
      currentPositions: new Map(),
      swapHistory: [],
      totalPnLUSD: 0,
      pnlPercent: 0,
    };

    // Start with APT position (users have APT in their wallets)
    const aptToken = SUPPORTED_TOKENS.find(t => t.symbol === 'APT')!;
    const aptPrice = getCurrentPrice('APT');
    const usdcPrice = getCurrentPrice('zUSDC'); // Should be 1.00, but using function for consistency
    
    // Use actual wallet balance if provided, otherwise convert USD to APT
    let aptAmount: number;
    if (initialAptBalance !== undefined) {
      // Use actual wallet balance - this is the snapshot at duel start
      aptAmount = initialAptBalance;
      // Convert to USDC (normalized baseline): APT amount * APT price / USDC price
      // Since USDC price is 1.00, this is effectively: APT amount * APT price
      state.initialBalanceUSD = (aptAmount * aptPrice) / usdcPrice;
      console.log(`[DecibelSwapService] Snapshot for ${playerAddress} at duel start:`, {
        aptAmount,
        aptPrice,
        initialBalanceUSD: state.initialBalanceUSD,
        normalizedToUSDC: state.initialBalanceUSD,
      });
    } else {
      // Convert USD balance to APT (for opponent or when wallet balance not available)
      aptAmount = initialBalanceUSD / aptPrice;
      // Normalize to USDC
      state.initialBalanceUSD = initialBalanceUSD / usdcPrice;
    }
    
    const aptAmountBaseUnits = aptAmount * Math.pow(10, aptToken.decimals); // Convert to base units (octas)
    
    state.currentPositions.set(aptToken.address, {
      token: aptToken,
      amount: aptAmountBaseUnits,
      avgEntryPrice: aptPrice,
      totalCostUSD: state.initialBalanceUSD, // This is now normalized to USDC
    });

    const key = `${duelId}-${playerAddress}`;
    this.playerStates.set(key, state);
  }

  /**
   * Execute a swap
   */
  async executeSwap(
    duelId: number,
    playerAddress: string,
    tokenInSymbol: string,
    tokenOutSymbol: string,
    amountIn: number // Amount in tokenIn's base units
  ): Promise<Swap> {
    const key = `${duelId}-${playerAddress}`;
    const state = this.playerStates.get(key);

    if (!state) {
      throw new Error(`Player ${playerAddress} not initialized for duel ${duelId}`);
    }

    const tokenIn = SUPPORTED_TOKENS.find(t => t.symbol === tokenInSymbol);
    const tokenOut = SUPPORTED_TOKENS.find(t => t.symbol === tokenOutSymbol);

    if (!tokenIn || !tokenOut) {
      throw new Error(`Invalid token pair: ${tokenInSymbol}/${tokenOutSymbol}`);
    }

    // Check if player has enough balance
    const position = state.currentPositions.get(tokenIn.address);
    if (!position || position.amount < amountIn) {
      throw new Error(`Insufficient balance for ${tokenInSymbol}`);
    }

    // Get current prices
    const priceIn = getCurrentPrice(tokenInSymbol);
    const priceOut = getCurrentPrice(tokenOutSymbol);

    // Calculate swap output
    const amountOut = calculateSwapOutput(
      amountIn / Math.pow(10, tokenIn.decimals), // Convert to human-readable
      priceIn,
      priceOut
    ) * Math.pow(10, tokenOut.decimals); // Convert back to base units

    const timestamp = Math.floor(Date.now() / 1000);
    const valueInUSD = (amountIn / Math.pow(10, tokenIn.decimals)) * priceIn;
    const valueOutUSD = (amountOut / Math.pow(10, tokenOut.decimals)) * priceOut;
    const pnlUSD = valueOutUSD - valueInUSD;

    // Create swap record
    const swap: Swap = {
      id: `swap-${duelId}-${playerAddress}-${timestamp}-${Math.random().toString(36).substr(2, 9)}`,
      duelId,
      playerAddress,
      timestamp,
      tokenIn,
      tokenOut,
      amountIn,
      amountOut,
      priceInUSD: priceIn,
      priceOutUSD: priceOut,
      valueInUSD,
      valueOutUSD,
      pnlUSD,
    };

    // Update positions
    // Remove from tokenIn position
    position.amount -= amountIn;
    if (position.amount <= 0) {
      state.currentPositions.delete(tokenIn.address);
    }

    // Add to tokenOut position
    const outPosition = state.currentPositions.get(tokenOut.address);
    if (outPosition) {
      // Update average entry price (weighted average)
      const newAmount = outPosition.amount + amountOut;
      const newTotalCost = outPosition.totalCostUSD + valueInUSD;
      outPosition.amount = newAmount;
      outPosition.avgEntryPrice = newTotalCost / (newAmount / Math.pow(10, tokenOut.decimals));
      outPosition.totalCostUSD = newTotalCost;
    } else {
      // Create new position
      console.log('[DecibelSwapService] Creating new position for tokenOut:', {
        symbol: tokenOut.symbol,
        address: tokenOut.address,
        amount: amountOut,
        amountHuman: amountOut / Math.pow(10, tokenOut.decimals),
      });
      state.currentPositions.set(tokenOut.address, {
        token: tokenOut,
        amount: amountOut,
        avgEntryPrice: priceOut,
        totalCostUSD: valueInUSD,
      });
      console.log('[DecibelSwapService] Position created. All positions now:', 
        Array.from(state.currentPositions.keys()).map(addr => {
          const pos = state.currentPositions.get(addr);
          return { address: addr, symbol: pos?.token.symbol };
        })
      );
    }

    // Update swap history
    state.swapHistory.push(swap);
    this.swapHistory.push(swap);

    // Recalculate P&L
    this.updatePlayerPnL(duelId, playerAddress);

    return swap;
  }

  /**
   * Update player's P&L based on current positions and swap history
   */
  private updatePlayerPnL(duelId: number, playerAddress: string): void {
    const key = `${duelId}-${playerAddress}`;
    const state = this.playerStates.get(key);
    if (!state) return;

    // Calculate current portfolio value
    let currentValueUSD = 0;
    for (const position of state.currentPositions.values()) {
      const currentPrice = getCurrentPrice(position.token.symbol);
      const amount = position.amount / Math.pow(10, position.token.decimals);
      currentValueUSD += amount * currentPrice;
    }

    // Calculate total P&L
    // Method 1: From swap history (realized P&L)
    const realizedPnL = state.swapHistory.reduce((sum, swap) => sum + swap.pnlUSD, 0);

    // Method 2: From current positions (unrealized P&L)
    let unrealizedPnL = 0;
    for (const position of state.currentPositions.values()) {
      const currentPrice = getCurrentPrice(position.token.symbol);
      const amount = position.amount / Math.pow(10, position.token.decimals);
      const currentValue = amount * currentPrice;
      unrealizedPnL += currentValue - position.totalCostUSD;
    }

    // Total P&L = realized (from trades) + unrealized (from current positions)
    // All normalized to USDC
    state.totalPnLUSD = realizedPnL + unrealizedPnL;
    
    // P&L percentage based on initial balance (snapshot at duel start, normalized to USDC)
    // Only considers trades made within the duel timeframe
    state.pnlPercent = state.initialBalanceUSD > 0 
      ? (state.totalPnLUSD / state.initialBalanceUSD) * 100 
      : 0;
  }

  /**
   * Get player's current state
   */
  getPlayerState(duelId: number, playerAddress: string): PlayerSwapState | null {
    const key = `${duelId}-${playerAddress}`;
    return this.playerStates.get(key) || null;
  }

  /**
   * Get all swaps for a duel
   */
  getDuelSwaps(duelId: number): Swap[] {
    return this.swapHistory.filter(swap => swap.duelId === duelId);
  }

  /**
   * Get swaps for a specific player in a duel
   */
  getPlayerSwaps(duelId: number, playerAddress: string): Swap[] {
    return this.swapHistory.filter(
      swap => swap.duelId === duelId && swap.playerAddress.toLowerCase() === playerAddress.toLowerCase()
    );
  }

  /**
   * Get final P&L percentage for a player (for reporting to backend)
   */
  getFinalPnLPercent(duelId: number, playerAddress: string): number {
    const state = this.getPlayerState(duelId, playerAddress);
    if (!state) return 0;

    // Final calculation: use current market prices for all positions
    this.updatePlayerPnL(duelId, playerAddress);
    return state.pnlPercent;
  }

  /**
   * Start price updates (for real-time P&L calculation)
   */
  startPriceUpdates(duelId: number, callback: (playerStates: Map<string, PlayerSwapState>) => void): void {
    if (this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval);
    }

    this.priceUpdateInterval = setInterval(() => {
      // Update P&L for all players in this duel
      const duelStates = new Map<string, PlayerSwapState>();
      for (const [key, state] of this.playerStates.entries()) {
        if (key.startsWith(`${duelId}-`)) {
          this.updatePlayerPnL(duelId, state.playerAddress);
          duelStates.set(state.playerAddress, state);
        }
      }
      callback(duelStates);
    }, 1000); // Update every second
  }

  /**
   * Stop price updates
   */
  stopPriceUpdates(): void {
    if (this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval);
      this.priceUpdateInterval = null;
    }
  }

  /**
   * Clean up state for a duel
   */
  cleanupDuel(duelId: number): void {
    for (const key of this.playerStates.keys()) {
      if (key.startsWith(`${duelId}-`)) {
        this.playerStates.delete(key);
      }
    }
    this.swapHistory = this.swapHistory.filter(swap => swap.duelId !== duelId);
  }
}

// Singleton instance
export const decibelSwapService = new DecibelSwapService();

