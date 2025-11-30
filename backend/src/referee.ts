import 'dotenv/config'; // Load environment variables from .env file
import { Aptos, AptosConfig, Network, Account, Ed25519PrivateKey } from "@aptos-labs/ts-sdk";
import { trackCampaignEvent } from "./photonService.js";
import { trackDuelWon } from "./leaderboardService.js";

type PnlReport = { playerAddress: string; pnlPercent: number };

// In-memory store keyed by duel_id -> reports[]
const reports: Record<number, PnlReport[]> = {};

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
 * Store a PnL report for a duel. Once both players have reported,
 * choose a winner and call the Move contract's resolve_duel function.
 */
export async function reportPnlForDuel(
  duelId: number,
  playerAddress: string,
  pnlPercent: number
): Promise<void> {
  if (!reports[duelId]) {
    reports[duelId] = [];
  }

  // If the same player reports twice, keep the latest value.
  const existingIndex = reports[duelId].findIndex(
    (r) => r.playerAddress.toLowerCase() === playerAddress.toLowerCase()
  );
  if (existingIndex >= 0) {
    reports[duelId][existingIndex] = { playerAddress, pnlPercent };
  } else {
    reports[duelId].push({ playerAddress, pnlPercent });
  }

  // We only resolve once two players have submitted.
  if (reports[duelId].length < 2) {
    console.log(`[referee] Duel ${duelId}: Waiting for both players (${reports[duelId].length}/2)`);
    return;
  }

  const [r1, r2] = reports[duelId];

  if (r1.pnlPercent === r2.pnlPercent) {
    console.log(
      `[referee] Duel ${duelId}: tie detected (${r1.pnlPercent}%) – leaving resolution to manual/admin logic`
    );
    // For ties, we could refund or use a tiebreaker
    delete reports[duelId];
    return;
  }

  const winner =
    r1.pnlPercent > r2.pnlPercent ? r1.playerAddress : r2.playerAddress;
  const loser = winner === r1.playerAddress ? r2.playerAddress : r1.playerAddress;

  console.log(
    `[referee] Duel ${duelId}: winner ${winner} (${r1.playerAddress}=${r1.pnlPercent}%, ${r2.playerAddress}=${r2.pnlPercent}%)`
  );

  // Track leaderboard activity
  trackDuelWon(winner);

  // Track Photon events for winner and loser
  // Note: We need Photon user IDs, not Aptos addresses
  // For MVP, we'll track with addresses and let Photon handle mapping
  try {
    // Track winner event (rewarded)
    await trackCampaignEvent(
      `duel_won-${duelId}-${Date.now()}`,
      'duel_won',
      winner, // This should be Photon user ID, but we'll use address for MVP
      { duelId, pnl: r1.pnlPercent > r2.pnlPercent ? r1.pnlPercent : r2.pnlPercent }
    );

    // Track loser event (unrewarded)
    await trackCampaignEvent(
      `duel_lost-${duelId}-${Date.now()}`,
      'duel_lost',
      loser,
      { duelId, pnl: winner === r1.playerAddress ? r2.pnlPercent : r1.pnlPercent }
    );
  } catch (error) {
    console.error('[referee] Error tracking Photon events:', error);
    // Continue anyway - Photon is optional
  }

  // Call Aptos Move contract resolve_duel(duel_id, winner)
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
    } catch (error) {
      console.error(`[referee] Error resolving duel ${duelId} on-chain:`, error);
      throw error;
    }
  } else {
    console.warn(`[referee] Admin account or module address not configured. Duel ${duelId} resolution mocked.`);
  }

  // Clear reports for this duel
  delete reports[duelId];
}


