import { Aptos, AptosConfig, Network, Account, AccountAddress } from '@aptos-labs/ts-sdk';
import { signAndSubmitWithPetra, isPetraInstalled } from './petraWallet';

const MODULE_ADDRESS = import.meta.env.VITE_MODULE_ADDRESS || '';
const MODULE_NAME = 'duel_arena';

// Initialize Aptos client
const network = (import.meta.env.VITE_APTOS_NETWORK as Network) || Network.MAINNET;
const config = new AptosConfig({ network });
export const aptosClient = new Aptos(config);

// Simple cache for balance to avoid rate limiting
const balanceCache: Map<string, { balance: number; timestamp: number }> = new Map();
const CACHE_TTL = 10000; // 10 seconds cache

// Cache for duels list to avoid rate limiting
const duelsCache: { data: DuelInfo[] | null; timestamp: number } = { data: null, timestamp: 0 };
const DUELS_CACHE_TTL = 30000; // 30 seconds cache for duels list

// Cache for individual duel lookups
const duelCache: Map<number, { data: DuelInfo | null; timestamp: number }> = new Map();
const DUEL_CACHE_TTL = 15000; // 15 seconds cache for individual duels


/**
 * Create a new duel
 * Supports both Account objects (for ephemeral accounts) and Petra wallet (address string)
 */
export async function createDuel(
  account: Account | string,
  wagerAmount: number, // in APT (will convert to octas)
  durationSecs: number
): Promise<string> {
  const wagerOctas = Math.floor(wagerAmount * 100_000_000); // Convert APT to octas

  // Get sender address
  const senderAddress = typeof account === 'string' 
    ? AccountAddress.fromString(account)
    : account.accountAddress;

  // Build transaction
  const transaction = await aptosClient.transaction.build.simple({
    sender: senderAddress,
    data: {
      function: `${MODULE_ADDRESS}::${MODULE_NAME}::create_duel`,
      functionArguments: [wagerOctas, durationSecs],
    },
  });

  // Use Petra wallet if account is a string (Petra address)
  let pendingTxn;
  if (typeof account === 'string' && isPetraInstalled()) {
    // For Petra wallet, pass the function and arguments directly
    const functionName = `${MODULE_ADDRESS}::${MODULE_NAME}::create_duel`;
    pendingTxn = await signAndSubmitWithPetra(
      transaction, 
      account,
      functionName,
      [wagerOctas, durationSecs],
      [] // No type arguments for create_duel
    );
  } else if (typeof account === 'object') {
    // Use SDK Account object - this handles signing and submission
    pendingTxn = await aptosClient.signAndSubmitTransaction({ 
      signer: account, 
      transaction 
    });
  } else {
    throw new Error('Invalid account type. Use Account object or Petra wallet address.');
  }

  await aptosClient.waitForTransaction({ transactionHash: pendingTxn.hash });

  // Extract duel_id from events (or return transaction hash for now)
  return pendingTxn.hash;
}

/**
 * Join an existing duel
 * Supports both Account objects (for ephemeral accounts) and Petra wallet (address string)
 */
export async function joinDuel(
  account: Account | string,
  duelId: number
): Promise<string> {
  // Get sender address
  const senderAddress = typeof account === 'string' 
    ? AccountAddress.fromString(account)
    : account.accountAddress;

  // Build transaction
  const transaction = await aptosClient.transaction.build.simple({
    sender: senderAddress,
    data: {
      function: `${MODULE_ADDRESS}::${MODULE_NAME}::join_duel`,
      functionArguments: [duelId],
    },
  });

  // Use Petra wallet if account is a string (Petra address)
  let pendingTxn;
  if (typeof account === 'string' && isPetraInstalled()) {
    // For Petra wallet, pass the function and arguments directly
    const functionName = `${MODULE_ADDRESS}::${MODULE_NAME}::join_duel`;
    pendingTxn = await signAndSubmitWithPetra(
      transaction, 
      account,
      functionName,
      [duelId],
      [] // No type arguments for join_duel
    );
  } else if (typeof account === 'object') {
    // Use SDK Account object - this handles signing and submission
    pendingTxn = await aptosClient.signAndSubmitTransaction({ 
      signer: account, 
      transaction 
    });
  } else {
    throw new Error('Invalid account type. Use Account object or Petra wallet address.');
  }

  await aptosClient.waitForTransaction({ transactionHash: pendingTxn.hash });

  return pendingTxn.hash;
}

/**
 * Get duel information
 * Tries view function first, falls back to querying DuelStore resource directly
 */
export async function getDuel(duelId: number, skipCache: boolean = false): Promise<DuelInfo | null> {
  // Check cache first
  if (!skipCache) {
    const cached = duelCache.get(duelId);
    if (cached && Date.now() - cached.timestamp < DUEL_CACHE_TTL) {
      return cached.data;
    }
  }

  try {
    // Try view function first (will work after contract is redeployed with #[view])
    try {
      const response = await aptosClient.view({
        payload: {
          function: `${MODULE_ADDRESS}::${MODULE_NAME}::get_duel`,
          functionArguments: [duelId],
        },
      });

      const [player1, player2, wagerAmount, durationSecs, startTime, , isResolved] = response as [
        string,
        string,
        string,
        string,
        string,
        boolean,
        boolean
      ];

      const duel: DuelInfo = {
        duelId,
        player1,
        player2,
        wagerAmount: Number(wagerAmount) / 100_000_000, // Convert octas to APT
        durationSecs: Number(durationSecs),
        startTime: Number(startTime),
        isResolved,
        createdAt: Number(startTime || 0),
        status: isResolved ? 'resolved' : (player2 === '0x0' ? 'open' : 'active'),
      };

      // Cache the result
      duelCache.set(duelId, { data: duel, timestamp: Date.now() });
      return duel;
    } catch (viewError: any) {
      // If view function fails (not a view function yet or rate limited), try REST API fallback
      if (viewError.message?.includes('not an view function') || 
          viewError.message?.includes('not a view') ||
          viewError.status === 429 ||
          viewError.message?.includes('429')) {
        // Fallback to direct REST API call to fetch from DuelStore table
        try {
          const fullnodeUrl = network === Network.MAINNET 
            ? 'https://fullnode.mainnet.aptoslabs.com'
            : 'https://fullnode.devnet.aptoslabs.com';
          const resourceUrl = `${fullnodeUrl}/v1/accounts/${MODULE_ADDRESS}/resource/${MODULE_ADDRESS}::${MODULE_NAME}::DuelStore`;
          const storeResponse = await fetch(resourceUrl);
          
          if (!storeResponse.ok) {
            if (storeResponse.status === 404) {
              return null; // DuelStore doesn't exist
            }
            throw new Error(`Failed to fetch DuelStore: ${storeResponse.status}`);
          }
          
          const storeData = await storeResponse.json();
          const duelsTableHandle = storeData.data.duels.handle;

          const tableItemUrl = `${fullnodeUrl}/v1/tables/${duelsTableHandle}/item`;
          const tableItemResponse = await fetch(tableItemUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              key_type: 'u64',
              value_type: `${MODULE_ADDRESS}::${MODULE_NAME}::Duel`,
              key: duelId.toString(),
            }),
          });

          if (!tableItemResponse.ok) {
            if (tableItemResponse.status === 404) {
              return null; // Duel not found
            }
            throw new Error(`Failed to fetch duel from table: ${tableItemResponse.status}`);
          }
          
          const duelData = await tableItemResponse.json();

          const duel: DuelInfo = {
            duelId,
            player1: duelData.player_1,
            player2: duelData.player_2,
            wagerAmount: Number(duelData.wager_amount) / 100_000_000,
            durationSecs: Number(duelData.duration_secs),
            startTime: Number(duelData.start_time),
            isResolved: duelData.is_resolved,
            createdAt: Number(duelData.start_time || 0),
            status: duelData.is_resolved ? 'resolved' : (duelData.player_2 === '0x0' ? 'open' : 'active'),
          };

          // Cache the result
          duelCache.set(duelId, { data: duel, timestamp: Date.now() });
          return duel;
        } catch (fallbackError) {
          console.warn(`[getDuel] Fallback REST API also failed for duel ${duelId}:`, fallbackError);
          return null;
        }
      }
      throw viewError;
    }
  } catch (error) {
    console.error(`[getDuel] Error fetching duel ${duelId}:`, error);
    return null;
  }
}

/**
 * Helper function to retry API calls with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      // If it's a rate limit error (429), wait and retry
      if (error.status === 429 || error.statusCode === 429 || error.message?.includes('429') || error.response?.status === 429) {
        if (attempt < maxRetries - 1) {
          const delay = baseDelay * Math.pow(2, attempt); // Exponential backoff
          console.warn(`[retryWithBackoff] Rate limited (429). Retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }
      // For non-429 errors, throw immediately
      throw error;
    }
  }
  
  throw lastError || new Error('Max retries exceeded');
}

/**
 * Get account balance in APT
 * Uses the official Aptos view function: 0x1::coin::balance
 * Reference: https://aptos.dev/build/guides/exchanges#retrieving-balances
 */
export async function getBalance(address: string): Promise<number> {
  try {
    // Clean and validate address
    let cleanAddress = address.trim();
    if (!cleanAddress.startsWith('0x')) {
      cleanAddress = '0x' + cleanAddress;
    }
    
    // Check cache first
    const cached = balanceCache.get(cleanAddress);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.log('[getBalance] Using cached balance:', cached.balance, 'APT');
      return cached.balance;
    }
    
    console.log('[getBalance] Fetching balance for:', cleanAddress);
    
    // Use the official Aptos view function to get balance
    // Reference: https://aptos.dev/build/guides/exchanges#retrieving-balances
    try {
      const coinType = '0x1::aptos_coin::AptosCoin';
      const [balanceStr] = await aptosClient.view<[string]>({
        payload: {
          function: '0x1::coin::balance',
          typeArguments: [coinType],
          functionArguments: [cleanAddress],
        },
      });
      
      const balanceOctas = parseInt(balanceStr, 10);
      if (!isNaN(balanceOctas)) {
        const balanceInAPT = balanceOctas / 100_000_000; // Convert octas to APT
        console.log('[getBalance] ✅ Balance from view function:', balanceInAPT, 'APT');
        // Cache the result
        balanceCache.set(cleanAddress, { balance: balanceInAPT, timestamp: Date.now() });
        return balanceInAPT;
      } else {
        console.warn('[getBalance] Invalid balance string:', balanceStr);
        return 0;
      }
    } catch (viewError: any) {
      console.error('[getBalance] Error calling view function:', viewError);
      
      // If account doesn't exist or isn't initialized, view might fail
      // Return 0 for uninitialized accounts
      if (viewError.status === 404 || viewError.message?.includes('404') || viewError.message?.includes('not found')) {
        console.warn('[getBalance] Account might not be initialized. Balance is 0.');
        return 0;
      }
      
      // For other errors, try retry with backoff
      try {
        console.log('[getBalance] Retrying with exponential backoff...');
        const [balanceStr] = await retryWithBackoff(async () => {
          return await aptosClient.view<[string]>({
            payload: {
              function: '0x1::coin::balance',
              typeArguments: ['0x1::aptos_coin::AptosCoin'],
              functionArguments: [cleanAddress],
            },
          });
        });
        
        const balanceOctas = parseInt(balanceStr, 10);
        if (!isNaN(balanceOctas)) {
          const balanceInAPT = balanceOctas / 100_000_000;
          console.log('[getBalance] ✅ Balance from view function (retry):', balanceInAPT, 'APT');
          balanceCache.set(cleanAddress, { balance: balanceInAPT, timestamp: Date.now() });
          return balanceInAPT;
        }
      } catch (retryError: any) {
        console.error('[getBalance] Error after retry:', retryError);
        return 0;
      }
      
      return 0;
    }
  } catch (error: any) {
    console.error('[getBalance] Fatal error:', error);
    return 0;
  }
}

/**
 * Get account coin balance (for FA or other coins like zUSDC)
 * @param address Account address
 * @param coinType Full coin type (e.g., 0xf22...::asset::USDC)
 */
export async function getAccountCoinAmount(address: string, coinType: string): Promise<number> {
  try {
    // Clean and validate address
    let cleanAddress = address.trim();
    if (!cleanAddress.startsWith('0x')) {
      cleanAddress = '0x' + cleanAddress;
    }
    
    console.log('[getAccountCoinAmount] Fetching balance for:', cleanAddress, coinType);
    
    try {
      const [balanceStr] = await aptosClient.view<[string]>({
        payload: {
          function: '0x1::coin::balance',
          typeArguments: [coinType],
          functionArguments: [cleanAddress],
        },
      });
      
      const balance = parseInt(balanceStr, 10);
      if (!isNaN(balance)) {
        return balance; // Return raw balance (caller handles decimals)
      }
      return 0;
    } catch (error) {
      console.warn('[getAccountCoinAmount] Error fetching coin balance:', error);
      return 0;
    }
  } catch (error) {
    console.error('[getAccountCoinAmount] Fatal error:', error);
    return 0;
  }
}

/**
 * Duel status types
 */
export type DuelStatus = 'open' | 'active' | 'resolved';

/**
 * Interface for duel info with status
 */
export interface DuelInfo {
  duelId: number;
  player1: string;
  player2: string;
  wagerAmount: number;
  durationSecs: number;
  startTime: number;
  createdAt: number;
  status: DuelStatus;
  isResolved: boolean;
  winner?: string; // Winner address for resolved duels
}

/**
 * Interface for open duel info (backward compatibility)
 */
export interface OpenDuel {
  duelId: number;
  player1: string;
  wagerAmount: number;
  durationSecs: number;
  createdAt: number;
}

/**
 * List all open duels (duels waiting for player 2)
 * Fetches DuelCreated events and filters for open duels
 */
export async function listOpenDuels(): Promise<OpenDuel[]> {
  try {
    if (!MODULE_ADDRESS) {
      console.warn('[listOpenDuels] MODULE_ADDRESS not set');
      return [];
    }
    
    // Query events using REST API
    // The event handle is stored at MODULE_ADDRESS in the DuelEvents resource
    // Event type: MODULE_ADDRESS::duel_arena::DuelCreatedEvent
    
    // Use REST API to query events
    // Use fullnode URL based on network
    const fullnodeUrl = network === Network.MAINNET 
      ? 'https://fullnode.mainnet.aptoslabs.com'
      : 'https://fullnode.devnet.aptoslabs.com';
    
    // Format: /v1/accounts/{address}/events/{event_handle_struct}/{field_name}
    // For DuelEvents, the handle is at MODULE_ADDRESS with field "created"
    // The full event handle path is: MODULE_ADDRESS::duel_arena::DuelEvents/created
    const eventHandleStruct = `${MODULE_ADDRESS}::${MODULE_NAME}::DuelEvents`;
    const eventFieldName = 'created';
    const apiUrl = `${fullnodeUrl}/v1/accounts/${MODULE_ADDRESS}/events/${encodeURIComponent(eventHandleStruct)}/${eventFieldName}`;
    
    console.log('[listOpenDuels] Querying events from:', apiUrl);
    
    try {
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[listOpenDuels] API error response:', errorText.substring(0, 200));
        
        if (response.status === 404) {
          console.warn('[listOpenDuels] No events found or event handle not initialized');
          return [];
        }
        throw new Error(`Failed to fetch events: ${response.status} ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type');
      const responseText = await response.text();
      
      if (!contentType || !contentType.includes('application/json')) {
        console.error('[listOpenDuels] Non-JSON response:', responseText.substring(0, 500));
        throw new Error('API returned non-JSON response');
      }

      let responseData;
      try {
        responseData = JSON.parse(responseText);
      } catch (parseError) {
        console.error('[listOpenDuels] Failed to parse JSON:', responseText.substring(0, 500));
        throw new Error('Invalid JSON response from API');
      }
      
      // Events might be wrapped in a data property or be an array directly
      const events = Array.isArray(responseData) ? responseData : (responseData.data || []);
      console.log('[listOpenDuels] Found events:', events.length);

      const openDuels: OpenDuel[] = [];

      // Process each event
      for (const event of events) {
        try {
          const eventData = event.data as any;
          const duelId = Number(eventData.duel_id);
          
          // Get current duel state to check if it's still open
          const duel = await getDuel(duelId);
          
          // Check if duel is truly open (no player 2)
          if (duel && !duel.isResolved && (duel.player2 === '0x0' || duel.player2 === '0x0000000000000000000000000000000000000000000000000000000000000000')) {
            // Duel is open (player2 hasn't joined yet)
            openDuels.push({
              duelId,
              player1: eventData.player_1 || duel.player1,
              wagerAmount: Number(eventData.wager_amount || duel.wagerAmount) / 100_000_000, // Convert to APT
              durationSecs: Number(eventData.duration_secs || duel.durationSecs),
              createdAt: Number(event.sequence_number || event.version || 0),
            });
          }
        } catch (eventError) {
          console.warn('[listOpenDuels] Error processing event:', eventError);
          // Continue with next event
        }
      }

      // Sort by most recent first
      const sortedDuels = openDuels.sort((a, b) => b.createdAt - a.createdAt);
      console.log('[listOpenDuels] Found', sortedDuels.length, 'open duels');
      return sortedDuels;
    } catch (apiError: any) {
      console.error('[listOpenDuels] Error fetching events from API:', apiError);
      
      // Fallback 1: Try querying recent transactions and extract events
      try {
        console.log('[listOpenDuels] Trying fallback: query recent transactions');
        const fullnodeUrl = network === Network.MAINNET 
          ? 'https://fullnode.mainnet.aptoslabs.com'
          : 'https://fullnode.devnet.aptoslabs.com';
        const txnUrl = `${fullnodeUrl}/v1/accounts/${MODULE_ADDRESS}/transactions?limit=50`;
        
        const txnResponse = await fetch(txnUrl);
        if (txnResponse.ok) {
          const transactions = await txnResponse.json();
          const openDuels: OpenDuel[] = [];
          
          // Look for DuelCreatedEvent in transaction events
          for (const txn of transactions) {
            if (txn.events && Array.isArray(txn.events)) {
              for (const event of txn.events) {
                const eventType = event.type;
                if (eventType && eventType.includes('DuelCreatedEvent')) {
                  try {
                    const eventData = event.data || {};
                    const duelId = Number(eventData.duel_id);
                    if (!isNaN(duelId)) {
                      const duel = await getDuel(duelId);
                      if (duel && !duel.isResolved && (duel.player2 === '0x0' || duel.player2 === '0x0000000000000000000000000000000000000000000000000000000000000000')) {
                        openDuels.push({
                          duelId,
                          player1: eventData.player_1 || duel.player1,
                          wagerAmount: Number(eventData.wager_amount || duel.wagerAmount) / 100_000_000,
                          durationSecs: Number(eventData.duration_secs || duel.durationSecs),
                          createdAt: Number(txn.version || txn.sequence_number || 0),
                        });
                      }
                    }
                  } catch (eventError) {
                    console.warn('[listOpenDuels] Error processing transaction event:', eventError);
                  }
                }
              }
            }
          }
          
          if (openDuels.length > 0) {
            console.log('[listOpenDuels] Found', openDuels.length, 'open duels from transactions');
            return openDuels.sort((a, b) => b.createdAt - a.createdAt);
          }
        }
      } catch (txnError) {
        console.error('[listOpenDuels] Transaction query fallback failed:', txnError);
      }
      
      // Fallback 2: Try brute force - check recent duel IDs (0-100)
      // This is a simple MVP approach that works even if get_duel isn't a view function yet
      try {
        console.log('[listOpenDuels] Trying brute force: checking recent duel IDs');
        const openDuels: OpenDuel[] = [];
        const maxDuelId = 100; // Reasonable limit for MVP
        
        // Check duels in reverse order (most recent first)
        // Use Promise.all with limited concurrency to check multiple duels in parallel
        const checkPromises: Promise<void>[] = [];
        const concurrency = 10; // Check 10 duels at a time
        
        for (let duelId = maxDuelId; duelId >= 0; duelId--) {
          // Add promise to check this duel
          checkPromises.push(
            (async () => {
              try {
                const duel = await getDuel(duelId);
                if (duel && !duel.isResolved && (duel.player2 === '0x0' || duel.player2 === '0x0000000000000000000000000000000000000000000000000000000000000000')) {
                  openDuels.push({
                    duelId,
                    player1: duel.player1,
                    wagerAmount: duel.wagerAmount,
                    durationSecs: duel.durationSecs,
                    createdAt: duel.startTime || Date.now(), // Use start time or current time as fallback
                  });
                  
                  // Limit to 20 most recent open duels for performance
                  if (openDuels.length >= 20) {
                    // Cancel remaining checks
                    return;
                  }
                }
              } catch (duelError: any) {
                // Duel doesn't exist or error fetching - continue silently
                // Only log if it's not a "not a view function" error
                if (!duelError.message?.includes('not an view function') && !duelError.message?.includes('not found')) {
                  // Ignore other errors for now
                }
              }
            })()
          );
          
          // Process in batches to avoid overwhelming the API
          if (checkPromises.length >= concurrency || duelId === 0) {
            await Promise.all(checkPromises);
            checkPromises.length = 0; // Clear array
            
            // If we found enough, stop
            if (openDuels.length >= 20) break;
          }
        }
        
        if (openDuels.length > 0) {
          console.log('[listOpenDuels] Found', openDuels.length, 'open duels via brute force');
          return openDuels.sort((a, b) => b.createdAt - a.createdAt);
        }
      } catch (bruteError) {
        console.error('[listOpenDuels] Brute force fallback failed:', bruteError);
      }
      
      return [];
    }
  } catch (error) {
    console.error('[listOpenDuels] Fatal error:', error);
    return [];
  }
}

/**
 * List all duels with their status
 * Returns all duels (open, active, resolved) with full information
 * Uses event-based querying - only queries duels that were actually created
 */
export async function listAllDuels(forceRefresh: boolean = false): Promise<DuelInfo[]> {
  try {
    if (!MODULE_ADDRESS) {
      console.warn('[listAllDuels] MODULE_ADDRESS not set');
      return [];
    }

    // Check cache first
    if (!forceRefresh && duelsCache.data && Date.now() - duelsCache.timestamp < DUELS_CACHE_TTL) {
      console.log('[listAllDuels] Returning cached duels');
      return duelsCache.data;
    }

    const fullnodeUrl = network === Network.MAINNET 
      ? 'https://fullnode.mainnet.aptoslabs.com'
      : 'https://fullnode.devnet.aptoslabs.com';
    const eventHandleStruct = `${MODULE_ADDRESS}::${MODULE_NAME}::DuelEvents`;
    const eventFieldName = 'created';
    const apiUrl = `${fullnodeUrl}/v1/accounts/${MODULE_ADDRESS}/events/${encodeURIComponent(eventHandleStruct)}/${eventFieldName}`;
    
    console.log('[listAllDuels] Querying DuelCreated events from:', apiUrl);
    
    try {
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          console.warn('[listAllDuels] No events found or event handle not initialized');
          return [];
        }
        const errorText = await response.text();
        console.error('[listAllDuels] API error response:', errorText.substring(0, 200));
        return [];
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const responseText = await response.text();
        console.error('[listAllDuels] Non-JSON response:', responseText.substring(0, 500));
        return [];
      }

      const events = await response.json();
      console.log('[listAllDuels] Found', events.length, 'DuelCreated events');

      // Process each event and get current duel state
      const allDuels: DuelInfo[] = [];
      
      // Process events in parallel but with limited concurrency to avoid rate limits
      const concurrency = 5;
      for (let i = 0; i < events.length; i += concurrency) {
        const batch = events.slice(i, i + concurrency);
        const batchPromises = batch.map(async (event: any) => {
          try {
            const eventData = event.data as any;
            const duelId = Number(eventData.duel_id);
            
            // Get current duel state to determine status (use cache if available)
            const duel = await getDuel(duelId, false);
            
            if (duel) {
              // Determine status - fixed logic
              let status: DuelStatus;
              let winner: string | undefined;
              
              // First check if explicitly resolved
              if (duel.isResolved) {
                status = 'resolved';
                // Try to get winner from DuelEndedEvent
                try {
                  const endedEventUrl = `${fullnodeUrl}/v1/accounts/${MODULE_ADDRESS}/events/${encodeURIComponent(eventHandleStruct)}/ended`;
                  const endedResponse = await fetch(endedEventUrl);
                  if (endedResponse.ok) {
                    const endedEvents = await endedResponse.json();
                    const endedEvent = endedEvents.find((e: any) => Number(e.data?.duel_id) === duelId);
                    if (endedEvent?.data?.winner) {
                      winner = endedEvent.data.winner;
                    }
                  }
                } catch (e) {
                  // Ignore errors fetching winner
                }
              } 
              // Check if duel is open (waiting for player 2)
              // IMPORTANT: When created, player2 is 0x0 and isActive is false
              // So we check player2 first, regardless of isActive
              else if (duel.player2 === '0x0' || duel.player2 === '0x0000000000000000000000000000000000000000000000000000000000000000') {
                // No player 2 yet - duel is open (regardless of isActive)
                status = 'open';
              } 
              // Both players have joined (player2 is not 0x0)
              else if (duel.player2 !== '0x0' && duel.player2 !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
                if (duel.startTime > 0) {
                  // Check if duel is still active (not expired)
                  const now = Math.floor(Date.now() / 1000);
                  const endTime = duel.startTime + duel.durationSecs;
                  if (now < endTime) {
                    status = 'active';
                  } else {
                    // Expired but not resolved yet - show as resolved
                    status = 'resolved';
                  }
                } else {
                  // Not active or startTime is 0 - must be resolved
                  status = 'resolved';
                }
              } 
              // Fallback: should not happen
              else {
                // Default to open if not resolved (safety fallback)
                status = duel.isResolved ? 'resolved' : 'open';
              }

              allDuels.push({
                duelId,
                player1: eventData.player_1 || duel.player1,
                player2: duel.player2,
                wagerAmount: Number(eventData.wager_amount || duel.wagerAmount) / 100_000_000,
                durationSecs: Number(eventData.duration_secs || duel.durationSecs),
                startTime: duel.startTime,
                createdAt: Number(event.sequence_number || event.version || duel.startTime || Date.now()),
                status,
                isResolved: duel.isResolved,
                winner,
              });
            }
          } catch (eventError) {
            console.warn('[listAllDuels] Error processing event:', eventError);
          }
        });
        
        await Promise.all(batchPromises);
        
        // Small delay between batches to avoid rate limiting
        if (i + concurrency < events.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      // Sort by most recent first
      const sortedDuels = allDuels.sort((a, b) => b.createdAt - a.createdAt);
      console.log('[listAllDuels] Found', sortedDuels.length, 'duels from events');
      
      // Cache the result
      duelsCache.data = sortedDuels;
      duelsCache.timestamp = Date.now();
      
      return sortedDuels;
    } catch (apiError: any) {
      console.error('[listAllDuels] Error fetching events from API:', apiError);
      return [];
    }
  } catch (error) {
    console.error('[listAllDuels] Fatal error:', error);
    return [];
  }
}

