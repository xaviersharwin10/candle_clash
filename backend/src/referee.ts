import 'dotenv/config'; // Load environment variables from .env file
import { Aptos, AptosConfig, Network, Account, Ed25519PrivateKey } from "@aptos-labs/ts-sdk";
import { trackCampaignEvent } from "./photonService.js";
import { trackDuelWon } from "./leaderboardService.js";

type PnlReport = { playerAddress: string; pnlPercent: number };

export interface Trade {
  playerAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  amountOut: number;
  timestamp: number;
  txHash?: string;
}

// Mock prices for P&L calculation (must match frontend)
const MOCK_PRICES: Record<string, number> = {
  'APT': 8.50,
  'zUSDC': 1.00,
  'BTC': 45000.00,
  'ETH': 2800.00,
};

const TOKEN_DECIMALS: Record<string, number> = {
  'APT': 8,
  'zUSDC': 6,
  'BTC': 8,
  'ETH': 18,
};

function getCurrentPrice(symbol: string): number {
  return MOCK_PRICES[symbol] || 0;
}

// In-memory store keyed by duel_id -> reports[]
const reports: Record<number, PnlReport[]> = {};
// In-memory store keyed by duel_id -> trades[]
const duelTrades: Record<number, Trade[]> = {};

// Initialize Aptos client
const MODULE_ADDRESS = process.env.MODULE_ADDRESS || "";
const MODULE_NAME = "duel_arena";
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY;

const aptosConfig = new AptosConfig({ network: (process.env.APTOS_NETWORK as Network) || Network.MAINNET });
const aptos = new Aptos(aptosConfig);

let adminAccount: Account | null = null;

// Initialize admin account if private key is provided
if (ADMIN_PRIVATE_KEY) {
  try {
    let privateKeyStr = ADMIN_PRIVATE_KEY.trim();
    
    // Handle Aptos CLI format: "ed25519-priv-0x..."
    if (privateKeyStr.startsWith("ed25519-priv-")) {
      privateKeyStr = privateKeyStr.replace("ed25519-priv-", "");
    }
    
    // Ensure private key has 0x prefix
    if (!privateKeyStr.startsWith("0x")) {
      privateKeyStr = `0x${privateKeyStr}`;
    }
    
    // Create Ed25519PrivateKey from hex string
    const privateKey = new Ed25519PrivateKey(privateKeyStr);
    
    // Create Account from PrivateKey
    adminAccount = Account.fromPrivateKey({ privateKey });
    console.log(`[referee] Admin account initialized: ${adminAccount.accountAddress.toString()}`);
  } catch (error) {
    console.error("[referee] Failed to initialize admin account:", error);
    console.error("[referee] Make sure ADMIN_PRIVATE_KEY is in the correct format (hex string, with or without 0x prefix)");
  }
} else {
  console.warn("[referee] ADMIN_PRIVATE_KEY not set. Duel resolution will be mocked.");
  console.warn("[referee] To enable automatic duel resolution, set ADMIN_PRIVATE_KEY in your .env file");
}

/**
 * Store a trade for a duel
 */
export function recordTradeForDuel(duelId: number, trade: Trade): void {
  if (!duelTrades[duelId]) {
    duelTrades[duelId] = [];
  }
  duelTrades[duelId].push(trade);
  console.log(`[referee] Recorded trade for duel ${duelId}: ${trade.tokenIn} -> ${trade.tokenOut} by ${trade.playerAddress}`);
}

/**
 * Get trades for a duel
 */
export function getTradesForDuel(duelId: number): Trade[] {
  return duelTrades[duelId] || [];
}

/**
 * Calculate P&L for a player based on recorded trades
 */
async function calculatePlayerPnl(duelId: number, playerAddress: string, wagerAmount: number): Promise<number> {
  const trades = duelTrades[duelId] || [];
  const playerTrades = trades.filter(t => t.playerAddress.toLowerCase() === playerAddress.toLowerCase());
  
  // Initial state
  // Convert wager (in APT) to USD
  const initialBalanceUSD = (wagerAmount / 100_000_000) * getCurrentPrice('APT');
  
  // Track positions: token symbol -> amount
  const positions: Record<string, number> = {};
  
  // Start with APT position from wager (effectively)
  // Actually, players trade from their wallet, but P&L is relative to the wager value snapshot
  // We assume they start with "wager value" worth of USD
  
  // Calculate realized P&L from trades
  let realizedPnL = 0;
  
  // Replay trades to calculate P&L
  // This is a simplified version of the frontend logic
  // We assume trades are valid and sequential
  
  // For each trade:
  // valueIn = amountIn * priceIn
  // valueOut = amountOut * priceOut
  // pnl = valueOut - valueIn
  for (const trade of playerTrades) {
    const priceIn = getCurrentPrice(trade.tokenIn);
    const priceOut = getCurrentPrice(trade.tokenOut);
    
    const decimalsIn = TOKEN_DECIMALS[trade.tokenIn] || 8;
    const decimalsOut = TOKEN_DECIMALS[trade.tokenOut] || 6;
    
    const valIn = (trade.amountIn / Math.pow(10, decimalsIn)) * priceIn;
    const valOut = (trade.amountOut / Math.pow(10, decimalsOut)) * priceOut;
    
    realizedPnL += (valOut - valIn);
  }
  
  // Total P&L %
  // Note: This is a simplified P&L that only tracks realized trade P&L
  // Ideally we'd track unrealized too, but backend doesn't track current wallet balances
  // For the MVP, realized P&L from swaps is a good proxy for trading performance
  
  if (initialBalanceUSD === 0) return 0;
  return (realizedPnL / initialBalanceUSD) * 100;
}

/**
 * Store a PnL report for a duel. Once both players have reported,
 * choose a winner and call the Move contract's resolve_duel function.
 * 
 * NEW LOGIC: When ANY player reports (time ends), we calculate P&L for BOTH
 * based on stored trades and resolve immediately. No waiting for the second player.
 */
export async function reportPnlForDuel(
  duelId: number,
  playerAddress: string,
  _clientPnlPercent: number // Ignored, we calculate our own
): Promise<void> {
  console.log(`[referee] Duel ${duelId}: Resolution triggered by ${playerAddress}`);

  // 1. Fetch duel info from chain to get players and wager
  let duelInfo;
  try {
    // Using view function or resource query
    const resource = await aptos.getAccountResource({
      accountAddress: MODULE_ADDRESS,
      resourceType: `${MODULE_ADDRESS}::${MODULE_NAME}::DuelStore`,
    });
    
    const handle = (resource as any).duels.handle;
    const item = await aptos.getTableItem({
      handle,
      data: {
        key_type: "u64",
        value_type: `${MODULE_ADDRESS}::${MODULE_NAME}::Duel`,
        key: duelId.toString(),
      },
    });
    duelInfo = item;
  } catch (error) {
    console.error(`[referee] Failed to fetch duel ${duelId} info:`, error);
    return;
  }

  if (!duelInfo) {
    console.error(`[referee] Duel ${duelId} not found on chain`);
    return;
  }

  // Cast to expected type
  const duel = duelInfo as { player_1: string; player_2: string; wager_amount: string };
  const player1 = duel.player_1;
  const player2 = duel.player_2;
  const wagerAmount = Number(duel.wager_amount); // in octas

  // 2. Calculate P&L for both players
  const p1PnL = await calculatePlayerPnl(duelId, player1, wagerAmount);
  const p2PnL = await calculatePlayerPnl(duelId, player2, wagerAmount);

  console.log(`[referee] Duel ${duelId} P&L Calculated:`);
  console.log(`  Player 1 (${player1}): ${p1PnL.toFixed(2)}%`);
  console.log(`  Player 2 (${player2}): ${p2PnL.toFixed(2)}%`);

  // 3. Determine winner
  let winner = player1;
  let loser = player2;
  
  if (p2PnL > p1PnL) {
    winner = player2;
    loser = player1;
  } else if (p1PnL === p2PnL) {
    // Tie: default to player 1 (or handle refund/tie logic)
    console.log(`[referee] Tie detected. Defaulting to Player 1.`);
  }

  // 4. Track events
  trackDuelWon(winner);
  
  try {
    await trackCampaignEvent(
      `duel_won-${duelId}-${Date.now()}`,
      'duel_won',
      winner,
      { duelId, pnl: Math.max(p1PnL, p2PnL) }
    );
    
    await trackCampaignEvent(
      `duel_lost-${duelId}-${Date.now()}`,
      'duel_lost',
      loser,
      { duelId, pnl: Math.min(p1PnL, p2PnL) }
    );
  } catch (e) {
    console.error('[referee] Photon tracking failed', e);
  }

  // 5. Resolve on-chain
  if (adminAccount && MODULE_ADDRESS) {
    try {
      const transaction = await aptos.transaction.build.simple({
        sender: adminAccount.accountAddress,
        data: {
          function: `${MODULE_ADDRESS}::${MODULE_NAME}::resolve_duel`,
          functionArguments: [duelId, winner],
        },
      });

      const committedTxn = await aptos.signAndSubmitTransaction({
        signer: adminAccount,
        transaction,
      });

      await aptos.waitForTransaction({ transactionHash: committedTxn.hash });
      console.log(`[referee] Duel ${duelId} resolved on-chain: ${committedTxn.hash}`);
    } catch (error: any) {
      // If already resolved, that's fine
      if (error.message?.includes('E_DUEL_ALREADY_RESOLVED') || error.message?.includes('0x4')) {
        console.log(`[referee] Duel ${duelId} was already resolved.`);
      } else {
        console.error(`[referee] Error resolving duel ${duelId}:`, error);
      }
    }
  } else {
    console.warn(`[referee] Mock resolution for ${duelId} (Admin key missing)`);
  }
  
  // Cleanup
  delete reports[duelId];
  delete duelTrades[duelId];
}


