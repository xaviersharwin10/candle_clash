/**
 * Petra Wallet Integration
 * Handles connection to Petra wallet extension
 */

// Petra wallet types
interface PetraWallet {
  connect(): Promise<{ address: string }>;
  disconnect(): Promise<void>;
  account(): Promise<{ address: string }>;
  signAndSubmitTransaction(payload: { payload: any } | any): Promise<{ hash: string }>;
  signTransaction(transaction: any): Promise<{ signature: string }>;
  network(): Promise<string>;
  isConnected(): Promise<boolean>;
  // Some Petra versions might have balance methods
  getBalance?: (address: string) => Promise<string>;
}

declare global {
  interface Window {
    aptos?: PetraWallet;
  }
}

/**
 * Check if Petra wallet is installed
 */
export function isPetraInstalled(): boolean {
  return typeof window !== 'undefined' && typeof window.aptos !== 'undefined';
}

/**
 * Connect to Petra wallet
 * If already connected, this will allow switching accounts
 */
export async function connectPetra(): Promise<{ address: string }> {
  if (!isPetraInstalled()) {
    throw new Error('Petra wallet is not installed. Please install it from https://petra.app/');
  }

  try {
    // Check if already connected
    const isConnected = await window.aptos!.isConnected();
    
    // If connected, disconnect first to allow account switching
    if (isConnected) {
      try {
        await window.aptos!.disconnect();
        // Small delay to ensure disconnect completes
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (disconnectError) {
        // Ignore disconnect errors, just proceed with connect
        console.log('[connectPetra] Disconnect error (ignored):', disconnectError);
      }
    }
    
    // Connect (this will show account selection if multiple accounts)
    const result = await window.aptos!.connect();
    return result;
  } catch (error: any) {
    if (error.code === 4001) {
      throw new Error('User rejected the connection request');
    }
    throw new Error(`Failed to connect to Petra wallet: ${error.message}`);
  }
}

/**
 * Switch account in Petra wallet
 * Disconnects and reconnects to allow account selection
 */
export async function switchPetraAccount(): Promise<{ address: string }> {
  if (!isPetraInstalled()) {
    throw new Error('Petra wallet is not installed. Please install it from https://petra.app/');
  }

  try {
    // Always disconnect first to ensure fresh connection
    try {
      await window.aptos!.disconnect();
      // Small delay to ensure disconnect completes
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (disconnectError) {
      // Ignore disconnect errors
      console.log('[switchPetraAccount] Disconnect error (ignored):', disconnectError);
    }
    
    // Connect again - this will show account selection
    const result = await window.aptos!.connect();
    return result;
  } catch (error: any) {
    if (error.code === 4001) {
      throw new Error('User rejected the connection request');
    }
    throw new Error(`Failed to switch account: ${error.message}`);
  }
}

/**
 * Disconnect from Petra wallet
 */
export async function disconnectPetra(): Promise<void> {
  if (!isPetraInstalled()) {
    return;
  }

  try {
    await window.aptos!.disconnect();
  } catch (error) {
    console.error('Error disconnecting from Petra wallet:', error);
  }
}

/**
 * Get current account address from Petra
 */
export async function getPetraAccount(): Promise<string | null> {
  if (!isPetraInstalled()) {
    return null;
  }

  try {
    const isConnected = await window.aptos!.isConnected();
    if (!isConnected) {
      return null;
    }

    const account = await window.aptos!.account();
    return account.address;
  } catch (error) {
    console.error('Error getting Petra account:', error);
    return null;
  }
}

/**
 * Get Petra wallet network
 */
export async function getPetraNetwork(): Promise<string | null> {
  if (!isPetraInstalled()) {
    return null;
  }

  try {
    const network = await window.aptos!.network();
    return network;
  } catch (error) {
    console.error('Error getting Petra network:', error);
    return null;
  }
}

/**
 * Check if Petra wallet is on the correct network (devnet)
 */
export async function checkPetraNetwork(): Promise<{ isCorrect: boolean; network: string | null }> {
  const network = await getPetraNetwork();
  const isCorrect = network?.toLowerCase() === 'mainnet';
  return { isCorrect, network };
}

/**
 * Verify account exists and get basic info
 */
export async function verifyAccount(address: string): Promise<{ exists: boolean; network?: string }> {
  if (!isPetraInstalled()) {
    return { exists: false };
  }

  try {
    const network = await getPetraNetwork();
    const account = await window.aptos!.account();
    
    // Verify the address matches
    const addressMatches = account.address.toLowerCase() === address.toLowerCase();
    
    return {
      exists: addressMatches,
      network: network || undefined,
    };
  } catch (error) {
    console.error('Error verifying account:', error);
    return { exists: false };
  }
}

/**
 * Sign and submit transaction using Petra wallet
 * Petra wallet expects the transaction in a specific format
 * Reference: https://aptos.dev/build/sdks/wallet-adapter/wallet-standards#dapp-api
 */
export async function signAndSubmitWithPetra(
  transaction: any,
  _senderAddress: string, // Not used, Petra uses connected account
  functionName?: string,
  functionArguments?: any[],
  typeArguments?: string[]
): Promise<{ hash: string }> {
  if (!isPetraInstalled()) {
    throw new Error('Petra wallet is not installed');
  }

  try {
    // Petra wallet expects a transaction in this format (Aptos Wallet Standard):
    // { payload: { function, typeArguments, functionArguments } }
    // Petra will automatically use the connected account as the sender
    
    // Use provided function details if available (most reliable)
    if (functionName && functionArguments !== undefined) {
      // Ensure functionArguments is always an array
      const args = Array.isArray(functionArguments) ? functionArguments : [functionArguments];
      
      // Petra wallet expects the payload in this format:
      // {
      //   type: 'entry_function_payload',
      //   function: string,
      //   type_arguments: string[],
      //   arguments: any[]
      // }
      const payload = {
        type: 'entry_function_payload',
        function: functionName,
        type_arguments: typeArguments || [] as string[],
        arguments: args,
      };

      console.log('[signAndSubmitWithPetra] Submitting transaction to Petra:', {
        type: payload.type,
        function: payload.function,
        type_arguments: payload.type_arguments,
        arguments: payload.arguments,
      });

      // Use the new format: { payload: {...} } as per Petra's deprecation warning
      try {
        const result = await window.aptos!.signAndSubmitTransaction({ payload });
        return { hash: result.hash };
      } catch (newFormatError: any) {
        // Fallback to old format if new format doesn't work
        console.warn('[signAndSubmitWithPetra] New format failed, trying old format:', newFormatError);
        const result = await window.aptos!.signAndSubmitTransaction(payload);
        return { hash: result.hash };
      }
    }

    // Fallback: try to extract from transaction object
    console.warn('[signAndSubmitWithPetra] No function details provided, attempting to extract from transaction object');
    
    // Try with payload wrapper first
    try {
      const result = await window.aptos!.signAndSubmitTransaction({ payload: transaction });
      return { hash: result.hash };
    } catch (wrappedError: any) {
      // Fallback to direct transaction
      console.warn('[signAndSubmitWithPetra] Wrapped format failed, trying direct:', wrappedError);
      const result = await window.aptos!.signAndSubmitTransaction(transaction);
      return { hash: result.hash };
    }
  } catch (error: any) {
    console.error('[signAndSubmitWithPetra] Error details:', error);
    if (error.code === 4001) {
      throw new Error('User rejected the transaction');
    }
    const errorMsg = error.message || error.toString() || JSON.stringify(error);
    throw new Error(`Transaction failed: ${errorMsg}`);
  }
}
