/**
 * Liquidswap Swap Integration
 * 
 * Executes actual on-chain swaps using Liquidswap DEX
 * Documentation: https://docs.liquidswap.com/integration/lets-swap
 */

import { 
  Account, 
  Aptos, 
  AptosConfig, 
  Network
} from '@aptos-labs/ts-sdk';
import { signAndSubmitWithPetra, isPetraInstalled } from './petraWallet';

// Liquidswap mainnet addresses
// From official docs: https://docs.liquidswap.com/smart-contracts
// Liquidswap modules are deployed at this address on mainnet
const LIQUIDSWAP_MODULE_ADDRESS = '0x190d44266241744264b964a37b8f09863167a12d3e70cda39376cfb4e3561e12';
// Scripts_v2 module (entry functions) - uses the same module address
const LIQUIDSWAP_SCRIPTS_V2 = LIQUIDSWAP_MODULE_ADDRESS;
// Router v2 module (for view functions like get_amount_out) - uses the same module address
const LIQUIDSWAP_ROUTER = LIQUIDSWAP_MODULE_ADDRESS;

// Coin type addresses
const APTOS_COIN = '0x1::aptos_coin::AptosCoin';
const USDC_COIN = '0xf22bede237a07e121b56d91a491eb7bcdfd1f5907926a9e58338f964a01b17fa::asset::USDC'; // Mainnet USDC

// Curve type for swaps
// From docs: liquidswap::curves::Uncorrelated or liquidswap::curves::Stable
// We'll use 'Uncorrelated' for APT/zUSDC pairs (uncorrelated assets)
// Full path: 0x190d44266241744264b964a37b8f09863167a12d3e70cda39376cfb4e3561e12::curves::Uncorrelated
const CURVE_TYPE = `${LIQUIDSWAP_MODULE_ADDRESS}::curves::Uncorrelated`;

// Initialize Aptos client for mainnet
const network = (import.meta.env.VITE_APTOS_NETWORK as Network) || Network.MAINNET;
const config = new AptosConfig({ network });
const aptosClient = new Aptos(config);

export interface SwapResult {
  transactionHash: string;
  amountIn: number;
  amountOut: number;
  tokenIn: string;
  tokenOut: string;
}

/**
 * Sort coins according to Liquidswap requirements
 * Coins must be sorted: compare struct name, then module name, then address
 */
function sortCoins(coinX: string, coinY: string): { coinA: string; coinB: string } {
  // Extract parts from coin type: ADDRESS::MODULE::STRUCT
  const parseCoin = (coin: string) => {
    const parts = coin.split('::');
    return {
      address: parts[0],
      module: parts[1] || '',
      struct: parts[2] || '',
    };
  };

  const x = parseCoin(coinX);
  const y = parseCoin(coinY);

  // Compare struct name first
  if (x.struct < y.struct) return { coinA: coinX, coinB: coinY };
  if (x.struct > y.struct) return { coinA: coinY, coinB: coinX };

  // If struct names are equal, compare module names
  if (x.module < y.module) return { coinA: coinX, coinB: coinY };
  if (x.module > y.module) return { coinA: coinY, coinB: coinX };

  // If module names are equal, compare addresses
  if (x.address < y.address) return { coinA: coinX, coinB: coinY };
  return { coinA: coinY, coinB: coinX };
}

/**
 * Get coin type address for a symbol
 */
function getCoinType(symbol: string): string {
  switch (symbol.toUpperCase()) {
    case 'APT':
      return APTOS_COIN;
    case 'ZUSDC':
      return USDC_COIN;
    default:
      throw new Error(`Unsupported coin: ${symbol}`);
  }
}

/**
 * Calculate minimum amount out with slippage tolerance
 */
function calculateMinAmountOut(amountOut: number, slippagePercent: number = 1.0): number {
  // Use 1% slippage by default for more safety
  return Math.floor(amountOut * (1 - slippagePercent / 100));
}


/**
 * Execute a Liquidswap swap
 * Uses scripts_v2::swap_exact_coin_for_coin entry function
 */
export async function executeLiquidswapSwap(
  account: Account | string,
  tokenInSymbol: 'APT' | 'zUSDC',
  tokenOutSymbol: 'APT' | 'zUSDC',
  amountIn: number // Amount in human-readable format
): Promise<SwapResult> {
  console.log('[Liquidswap] Starting swap', { tokenInSymbol, tokenOutSymbol, amountIn });

  if (tokenInSymbol === tokenOutSymbol) {
    throw new Error('Cannot swap same token');
  }

  // Get coin types
  const coinIn = getCoinType(tokenInSymbol);
  const coinOut = getCoinType(tokenOutSymbol);

  // Sort coins (required by Liquidswap)
  const { coinA, coinB } = sortCoins(coinIn, coinOut);
  const isReversed = coinA !== coinIn;

  console.log('[Liquidswap] Sorted coins:', { coinA, coinB, isReversed });

  // Convert amount to base units (octas for APT, 6 decimals for zUSDC)
  const decimalsIn = tokenInSymbol === 'APT' ? 8 : 6;
  const decimalsOut = tokenOutSymbol === 'APT' ? 8 : 6;
  const amountInBaseUnits = Math.floor(amountIn * Math.pow(10, decimalsIn));

  // Get estimated amount out for slippage calculation
  // Since get_amount_out is not a view function, we'll estimate using pool reserves
  // We use the constant product formula: (x + Δx) * (y - Δy) = x * y
  // Solving for Δy: Δy = (y * Δx) / (x + Δx)
  // With fees: amountInAfterFee = amountIn * (1 - fee)
  let estimatedAmountOut = 0;
  
  try {
    // Get pool reserves (this IS a view function)
    const reservesResponse = await aptosClient.view({
      payload: {
        function: `${LIQUIDSWAP_ROUTER}::router_v2::get_reserves_size`,
        typeArguments: [coinA, coinB, CURVE_TYPE],
        functionArguments: [],
      },
    });
    
    const [reserveX, reserveY] = reservesResponse as [string, string];
    const reserveXNum = Number(reserveX);
    const reserveYNum = Number(reserveY);
    
    console.log('[Liquidswap] Pool reserves:', { reserveX: reserveXNum, reserveY: reserveYNum });
    
    if (reserveXNum > 0 && reserveYNum > 0) {
      // Determine which reserve is which based on coin order
      const reserveIn = isReversed ? reserveYNum : reserveXNum;
      const reserveOut = isReversed ? reserveXNum : reserveYNum;
      
      // Get actual fee from the pool (this is a view function)
      let feeMultiplier = BigInt(997); // Default 0.3% fee (997/1000)
      let feeDenominator = BigInt(1000);
      
      try {
        const feeResponse = await aptosClient.view({
          payload: {
            function: `${LIQUIDSWAP_ROUTER}::router_v2::get_fees_config`,
            typeArguments: [coinA, coinB, CURVE_TYPE],
            functionArguments: [],
          },
        });
        
        const [feePct, feeScale] = feeResponse as [string, string];
        feeMultiplier = BigInt(Number(feeScale) - Number(feePct));
        feeDenominator = BigInt(feeScale);
        console.log('[Liquidswap] Pool fee:', { feePct, feeScale, multiplier: feeMultiplier.toString() });
      } catch (error) {
        console.warn('[Liquidswap] Could not get pool fee, using default 0.3%');
      }
      
      const amountInU128 = BigInt(amountInBaseUnits);
      const reserveInU128 = BigInt(reserveIn);
      const reserveOutU128 = BigInt(reserveOut);
      
      // According to router_v2 code for uncorrelated:
      // coin_in_val_after_fees = math::mul_to_u128(coin_in, fee_multiplier)
      // new_reserve_in = math::mul_to_u128(reserve_in, fee_scale) + coin_in_val_after_fees
      // amount_out = math::mul_div_u128(coin_in_val_after_fees, reserve_out_u128, new_reserve_in)
      
      // So: amount_out = (coin_in * fee_multiplier * reserve_out) / (reserve_in * fee_scale + coin_in * fee_multiplier)
      const coinInAfterFees = amountInU128 * feeMultiplier;
      const newReserveIn = (reserveInU128 * feeDenominator) + coinInAfterFees;
      const numerator = coinInAfterFees * reserveOutU128;
      const estimatedOut = numerator / newReserveIn;
      
      estimatedAmountOut = Number(estimatedOut);
      console.log('[Liquidswap] Calculated amount out from reserves:', {
        amountIn: amountInBaseUnits,
        coinInAfterFees: coinInAfterFees.toString(),
        reserveIn,
        reserveOut,
        newReserveIn: newReserveIn.toString(),
        estimatedOut: estimatedAmountOut,
      });
    } else {
      throw new Error('Pool reserves are zero or invalid');
    }
  } catch (error) {
    console.warn('[Liquidswap] Could not get reserves, using price-based estimate:', error);
    
    // Fallback: Use current APT price from CoinGecko
    let aptPriceUSD = 8.50; // Default fallback
    try {
      const coingeckoResponse = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=aptos&vs_currencies=usd');
      if (coingeckoResponse.ok) {
        const data = await coingeckoResponse.json();
        aptPriceUSD = data.aptos?.usd || 8.50;
      }
    } catch (e) {
      console.warn('[Liquidswap] CoinGecko error, using default price');
    }
    
    if (tokenInSymbol === 'APT' && tokenOutSymbol === 'zUSDC') {
      // APT -> zUSDC: amountIn * APT_price (accounting for decimals)
      // amountIn is in APT (8 decimals), we need zUSDC (6 decimals)
      estimatedAmountOut = Math.floor(amountIn * aptPriceUSD * Math.pow(10, 6)); // zUSDC has 6 decimals
    } else if (tokenInSymbol === 'zUSDC' && tokenOutSymbol === 'APT') {
      // zUSDC -> APT: amountIn / APT_price (accounting for decimals)
      // amountIn is in zUSDC (6 decimals), we need APT (8 decimals)
      estimatedAmountOut = Math.floor((amountIn * Math.pow(10, 6)) / aptPriceUSD); // Result in APT base units (8 decimals)
    }
    
    console.log('[Liquidswap] Estimated amount out from price API:', estimatedAmountOut);
  }

  // Ensure we have a valid estimate
  if (estimatedAmountOut <= 0) {
    throw new Error('Could not estimate swap output amount. Pool may not exist or may have insufficient liquidity.');
  }

  // Calculate minimum amount out with dynamic slippage tolerance
  // For small amounts (< 1.0 unit), use higher slippage due to:
  // - Higher impact of fees on small amounts
  // - More price impact on small pools
  // - Rounding errors are more significant
  const isSmallAmount = amountIn < 1.0;
  const slippagePercent = isSmallAmount ? 5.0 : 2.0; // 5% for small, 2% for larger
  
  let minAmountOut = calculateMinAmountOut(estimatedAmountOut, slippagePercent);
  console.log('[Liquidswap] Estimated amount out:', estimatedAmountOut);
  console.log(`[Liquidswap] Minimum amount out (${slippagePercent}% slippage):`, minAmountOut);
  
  // Safety check: ensure minAmountOut is reasonable
  if (minAmountOut <= 0) {
    throw new Error('Calculated minimum amount out is zero or negative. Swap cannot proceed.');
  }
  
  // Additional safety buffer based on amount size
  // For small amounts, use 10% buffer (0.90), for larger use 2% buffer (0.98)
  const bufferMultiplier = isSmallAmount ? 0.90 : 0.98;
  const absoluteMin = Math.floor(estimatedAmountOut * bufferMultiplier);
  const finalMinAmountOut = Math.min(minAmountOut, absoluteMin);
  
  if (finalMinAmountOut !== minAmountOut) {
    console.warn('[Liquidswap] Adjusted minAmountOut for additional safety:', {
      original: minAmountOut,
      adjusted: finalMinAmountOut,
      buffer: `${((1 - bufferMultiplier) * 100).toFixed(0)}%`,
    });
    minAmountOut = finalMinAmountOut;
  }


  // Build transaction using scripts::swap
  // From API: swap<X, Y, Curve>(&signer, coin_val: u64, coin_out_min_val: u64)
  // This is the entry function in scripts module (not scripts_v2)
  const functionName = `${LIQUIDSWAP_SCRIPTS_V2}::scripts::swap`;
  const typeArguments = [coinA, coinB, CURVE_TYPE];
  const functionArguments = [
    amountInBaseUnits.toString(), // amount_in
    minAmountOut.toString(), // amount_out_min (slippage protection)
  ];

  console.log('[Liquidswap] Building transaction...', {
    function: functionName,
    typeArguments,
    functionArguments,
  });

  let pendingTxn;

  if (typeof account === 'object') {
    // For Account objects (Google Sign-In)
    try {
      const transaction = await aptosClient.transaction.build.simple({
        sender: account.accountAddress,
        data: {
          function: functionName,
          typeArguments: typeArguments,
          functionArguments: functionArguments,
        },
      });

      pendingTxn = await aptosClient.signAndSubmitTransaction({
        signer: account,
        transaction,
      });

      console.log('[Liquidswap] ✅ Transaction submitted:', pendingTxn.hash);
    } catch (error: any) {
      console.error('[Liquidswap] Transaction failed:', error);
      
      // Handle rate limiting errors
      if (error.message?.includes('429') || error.message?.includes('Per anonym') || error.message?.includes('Too Many Requests')) {
        throw new Error(
          'Rate limit exceeded. Please wait a moment and try again.\n\n' +
          'The Aptos API is temporarily rate limiting requests. This is a temporary issue.'
        );
      }
      
      throw error;
    }
  } else if (typeof account === 'string' && isPetraInstalled()) {
    // For Petra wallet - use direct payload to avoid ABI fetching (rate limits)
    // This bypasses the need to fetch module ABI which causes 429 errors
    try {
      console.log('[Liquidswap] Using Petra wallet with direct payload (bypassing ABI fetch)');
      
      // Use Petra wallet directly with payload format
      // This avoids the SDK's transaction.build which requires ABI fetching
      pendingTxn = await signAndSubmitWithPetra(
        null, // No transaction object - Petra will build it from payload
        account,
        functionName,
        functionArguments,
        typeArguments
      );

      console.log('[Liquidswap] ✅ Transaction submitted via Petra:', pendingTxn.hash);
    } catch (error: any) {
      console.error('[Liquidswap] Petra transaction failed:', error);
      
      // Provide helpful error message for rate limiting
      if (error.message?.includes('429') || error.message?.includes('Per anonym')) {
        throw new Error(
          'Rate limit exceeded. Please wait a moment and try again.\n\n' +
          'The Aptos API is temporarily rate limiting requests. This is a temporary issue.'
        );
      }
      
      throw error;
    }
  } else {
    throw new Error('Invalid account type. Please use Petra wallet or Google Sign-In.');
  }

  // Wait for transaction confirmation
  try {
    await aptosClient.waitForTransaction({
      transactionHash: pendingTxn.hash,
    });
    console.log('[Liquidswap] ✅ Transaction confirmed!');
  } catch (error) {
    console.warn('[Liquidswap] Could not wait for confirmation:', error);
  }

  // Calculate expected output (in production, parse from transaction events)
  const amountOut = estimatedAmountOut / Math.pow(10, decimalsOut);

  return {
    transactionHash: pendingTxn.hash,
    amountIn,
    amountOut,
    tokenIn: tokenInSymbol,
    tokenOut: tokenOutSymbol,
  };
}

