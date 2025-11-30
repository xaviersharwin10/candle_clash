import { useEffect, useRef, useState } from 'react';
import { createChart, LineSeries } from 'lightweight-charts';
import { Account } from '@aptos-labs/ts-sdk';
import { 
  decibelSwapService, 
  SUPPORTED_TOKENS, 
  type PlayerSwapState,
  type SwapToken,
  type Swap
} from '../lib/decibelSwapService';
import { executeLiquidswapSwap } from '../lib/liquidswapSwap';
import { reportPnL, reportSwapExecuted, recordDuelTrade, getDuelTrades } from '../lib/backendClient';
import { photonService, PhotonEvents } from '../lib/photonService';
import { getBalance, getAccountCoinAmount, getDuel } from '../lib/aptosClient';

// Define all types locally since lightweight-charts doesn't export them as named exports
type Time = string | number;

interface TradingViewProps {
  duelId: number;
  playerAddress: string;
  opponentAddress: string;
  durationSecs: number;
  startTime: number; // Unix timestamp in seconds when duel started
  wagerAmount: number; // Wager amount in APT
  account: Account | string | null; // Account for signing transactions
  onDuelEnd: () => void;
}

// APT price in USD (for converting wager to USD)
const APT_PRICE_USD = 8.50; // This should be fetched from a price oracle in production

export default function TradingView({
  duelId,
  playerAddress,
  opponentAddress,
  durationSecs,
  startTime,
  wagerAmount,
  account,
  onDuelEnd,
}: TradingViewProps) {
  // Convert wager amount (APT) to USD for initial balance
  const initialBalanceUSD = wagerAmount * APT_PRICE_USD;
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const playerLineRef = useRef<any>(null);
  const opponentLineRef = useRef<any>(null);
  
  const [pnlHistory, setPnlHistory] = useState<{time: number, player: number, opponent: number}[]>([]);
  
  // Filter to only APT and zUSDC for swaps
  const AVAILABLE_TOKENS = SUPPORTED_TOKENS.filter(t => t.symbol === 'APT' || t.symbol === 'zUSDC');
  
  // Swap state - only APT and zUSDC
  const [tokenIn, setTokenIn] = useState<SwapToken>(AVAILABLE_TOKENS.find(t => t.symbol === 'zUSDC')!);
  const [tokenOut, setTokenOut] = useState<SwapToken>(AVAILABLE_TOKENS.find(t => t.symbol === 'APT')!);
  const [swapAmount, setSwapAmount] = useState('');
  const [isSwapping, setIsSwapping] = useState(false);
  
  // Player states - track swaps made in our platform
  const [playerState, setPlayerState] = useState<PlayerSwapState | null>(null);
  const [opponentState, setOpponentState] = useState<PlayerSwapState | null>(null);
  
  // Calculate initial time remaining based on startTime
  const calculateTimeRemaining = () => {
    const now = Math.floor(Date.now() / 1000);
    const endTime = startTime + durationSecs;
    return Math.max(0, endTime - now);
  };
  
  // Chart state
  const [timeRemaining, setTimeRemaining] = useState(calculateTimeRemaining());
  const [isGameActive, setIsGameActive] = useState(true);
  const [hasReportedPnL, setHasReportedPnL] = useState(false);
  const [duelWinner, setDuelWinner] = useState<string | null>(null);
  
  // Track swaps made within our platform during this duel only
  const [duelStartTime] = useState(Math.floor(Date.now() / 1000)); // Duel start timestamp
  const [platformSwaps, setPlatformSwaps] = useState<Swap[]>([]); // Swaps made through our platform
  
  // Real wallet balance
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);

  // Fetch actual wallet balance
  useEffect(() => {
    const fetchBalance = async () => {
      if (!playerAddress) return;
      try {
        // Fetch APT balance
        const balance = await getBalance(playerAddress);
        console.log('[TradingView] APT balance fetched:', balance, 'APT');
        setWalletBalance(balance);
        
        // Fetch zUSDC balance
        const usdcToken = SUPPORTED_TOKENS.find(t => t.symbol === 'zUSDC');
        if (usdcToken) {
          const usdcRaw = await getAccountCoinAmount(playerAddress, usdcToken.address);
          const usdc = usdcRaw / Math.pow(10, usdcToken.decimals);
          console.log('[TradingView] zUSDC balance fetched:', usdc, 'zUSDC');
          setUsdcBalance(usdc);
        }
      } catch (error) {
        console.error('[TradingView] Error fetching wallet balance:', error);
        if (walletBalance === null) setWalletBalance(0);
        if (usdcBalance === null) setUsdcBalance(0);
      }
    };
    fetchBalance();
    // Refresh balance every 10 seconds
    const interval = setInterval(fetchBalance, 10000);
    return () => clearInterval(interval);
  }, [playerAddress]);

  // Sync trades from backend (poll every 3 seconds)
  useEffect(() => {
    const syncTrades = async () => {
      try {
        // console.log('[TradingView] Syncing trades from backend...');
        const trades = await getDuelTrades(duelId);
        
        // Get current local swaps
        const currentSwaps = decibelSwapService.getDuelSwaps(duelId);
        
        // Filter trades that are not in local service
        // Use txHash for reliable de-duping if available, otherwise fallback to timestamp/amount
        const missingTrades = trades.filter(t => 
          !currentSwaps.some(s => {
            if (t.txHash && s.txHash) {
              return s.txHash === t.txHash;
            }
            return s.timestamp === t.timestamp && 
                   s.amountIn === t.amountIn && 
                   s.tokenIn.symbol === t.tokenIn;
          })
        );
        
        if (missingTrades.length > 0) {
          console.log('[TradingView] Syncing', missingTrades.length, 'new trades');
          // Sort by timestamp ascending to replay correctly
          missingTrades.sort((a, b) => a.timestamp - b.timestamp);
          
          for (const trade of missingTrades) {
            await decibelSwapService.executeSwap(
              duelId,
              trade.playerAddress,
              trade.tokenIn,
              trade.tokenOut,
              trade.amountIn,
              trade.txHash
            );
          }
          
          // Update platform swaps state
          const allSwaps = decibelSwapService.getDuelSwaps(duelId);
          const duelSwaps = allSwaps.filter(swap => swap.timestamp >= duelStartTime);
          duelSwaps.sort((a, b) => b.timestamp - a.timestamp);
          setPlatformSwaps(duelSwaps);
          
          // Update player states
          const pState = decibelSwapService.getPlayerState(duelId, playerAddress);
          const oState = decibelSwapService.getPlayerState(duelId, opponentAddress);
          if (pState) setPlayerState(pState);
          if (oState) setOpponentState(oState);
        }
      } catch (error) {
        console.error('[TradingView] Error syncing trades:', error);
      }
    };
    
    // Initial sync
    if (playerAddress) {
      syncTrades();
    }

    // Poll for updates
    const interval = setInterval(syncTrades, 3000);
    return () => clearInterval(interval);
  }, [duelId, playerAddress, opponentAddress, duelStartTime]);

  // Initialize players and start price updates
  useEffect(() => {
    // Use actual wallet balance if available, otherwise use wager-based initial balance
    const actualBalanceUSD = walletBalance !== null 
      ? walletBalance * APT_PRICE_USD 
      : initialBalanceUSD;
    
    console.log('[TradingView] Initializing players', {
      walletBalance,
      usdcBalance,
      actualBalanceUSD,
      initialBalanceUSD,
    });
    
    // Initialize both players with actual balance
    // For the player: use actual wallet balance if available
    decibelSwapService.initializePlayer(
      duelId, 
      playerAddress, 
      actualBalanceUSD,
      walletBalance !== null ? walletBalance : undefined // Pass actual APT balance
    );
    // Note: We don't pass USDC balance to initializePlayer because it currently expects normalized USD
    // But getTokenBalance will check real wallet balance for USDC now
    
    decibelSwapService.initializePlayer(duelId, opponentAddress, initialBalanceUSD);
    
    // Start price updates
    decibelSwapService.startPriceUpdates(duelId, (playerStates) => {
      const player = playerStates.get(playerAddress);
      const opponent = playerStates.get(opponentAddress);
      if (player) setPlayerState(player);
      if (opponent) setOpponentState(opponent);
      
      // Update P&L history
      const now = Math.floor(Date.now() / 1000);
      setPnlHistory(prev => {
        // Don't add duplicate timestamps
        if (prev.length > 0 && prev[prev.length - 1].time === now) return prev;
        return [...prev, {
          time: now,
          player: player?.pnlPercent || 0,
          opponent: opponent?.pnlPercent || 0
        }];
      });
    });
    
    // Get initial states
    setPlayerState(decibelSwapService.getPlayerState(duelId, playerAddress));
    setOpponentState(decibelSwapService.getPlayerState(duelId, opponentAddress));
    
    return () => {
      decibelSwapService.stopPriceUpdates();
    };
  }, [duelId, playerAddress, opponentAddress, initialBalanceUSD, walletBalance, usdcBalance]);

  // Track swaps made through our platform during this duel
  // Load swaps immediately on mount and persist them (they're stored in the service singleton)
  useEffect(() => {
    // Load swaps from the service (they persist in the service singleton)
    const updatePlatformSwaps = () => {
      // Get swaps made through our platform for this specific duel
      const allSwaps = decibelSwapService.getDuelSwaps(duelId);
      
      // Filter swaps made during duel period (safety check)
      const duelSwaps = allSwaps.filter(swap => swap.timestamp >= duelStartTime);
      
      // Sort by timestamp (most recent first)
      duelSwaps.sort((a, b) => b.timestamp - a.timestamp);
      setPlatformSwaps(duelSwaps);
    };

    // Update immediately on mount (load persisted swaps)
    updatePlatformSwaps();

    // Poll every second for new swaps (only if game is active)
    let interval: ReturnType<typeof setInterval> | null = null;
    if (isGameActive) {
      interval = setInterval(updatePlatformSwaps, 1000);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [duelId, duelStartTime, isGameActive, playerState]); // Added playerState to reload when swaps are made

  // Track Photon event: duel_watched
  useEffect(() => {
    (async () => {
      await photonService.trackEvent(
        `duel_watched-${duelId}-${Date.now()}`,
        PhotonEvents.DUEL_WATCHED,
        { duelId, playerAddress, opponentAddress }
      );
    })();
  }, [duelId, playerAddress, opponentAddress]);

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 400,
      layout: {
        background: { color: '#0a0a0a' },
        textColor: '#00ff41',
      },
      grid: {
        vertLines: { color: '#1a1a1a' },
        horzLines: { color: '#1a1a1a' },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: true,
      },
    });

    const playerLineSeries = chart.addSeries(LineSeries, {
      color: '#00ff41',
      lineWidth: 2,
      title: 'You',
    });

    const opponentLineSeries = chart.addSeries(LineSeries, {
      color: '#ff0080',
      lineWidth: 2,
      title: 'Opponent',
    });

    chartRef.current = chart;
    playerLineRef.current = playerLineSeries;
    opponentLineRef.current = opponentLineSeries;

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  // Update P&L data on chart
  useEffect(() => {
    if (!chartRef.current || !playerLineRef.current || !opponentLineRef.current) return;
    
    const playerData = pnlHistory.map(d => ({ time: d.time as Time, value: d.player }));
    const opponentData = pnlHistory.map(d => ({ time: d.time as Time, value: d.opponent }));
    
    playerLineRef.current.setData(playerData);
    opponentLineRef.current.setData(opponentData);
    
    chartRef.current.timeScale().fitContent();
  }, [pnlHistory]);

  // Countdown timer and auto-report P&L
  useEffect(() => {
    // Update time remaining based on actual start time
    const updateTimeRemaining = () => {
      const remaining = calculateTimeRemaining();
      setTimeRemaining(remaining);
      
      if (remaining <= 0) {
        setIsGameActive(false);
        
        if (!hasReportedPnL && playerState) {
          // Use P&L from swaps made in our platform during this duel
          const finalPnL = playerState.pnlPercent;
          reportPnL(duelId, playerAddress, finalPnL).then(async (success) => {
            if (success) {
              setHasReportedPnL(true);
              await photonService.trackEvent(
                `duel_completed-${duelId}-${Date.now()}`,
                'duel_completed',
                { duelId, playerAddress, pnl: finalPnL }
              );
              onDuelEnd();
            }
          });
        }
      }
    };

    // Update immediately
    updateTimeRemaining();

    // Update every second
    const timer = setInterval(updateTimeRemaining, 1000);

    return () => clearInterval(timer);
  }, [isGameActive, hasReportedPnL, duelId, playerAddress, onDuelEnd, playerState, startTime, durationSecs]);

  // Poll for resolution status after game ends
  useEffect(() => {
    if (isGameActive || duelWinner) return;

    const checkResolution = async () => {
      try {
        const duel = await getDuel(duelId, true); // true = skip cache
        if (duel && duel.isResolved && duel.winner) {
          setDuelWinner(duel.winner);
        }
      } catch (error) {
        console.error('Error checking resolution:', error);
      }
    };

    const interval = setInterval(checkResolution, 2000);
    return () => clearInterval(interval);
  }, [isGameActive, duelWinner, duelId]);

  const handleSwap = async () => {
    console.log('[TradingView] handleSwap called', {
      swapAmount,
      isSwapping,
      isGameActive,
      hasPlayerState: !!playerState,
      hasAccount: !!account,
      tokenIn: tokenIn.symbol,
      tokenOut: tokenOut.symbol,
    });

    // Check all conditions with detailed logging
    if (!swapAmount) {
      console.warn('[TradingView] No swap amount');
      alert('Please enter an amount to swap');
      return;
    }

    if (isSwapping) {
      console.warn('[TradingView] Already swapping');
      return;
    }

    if (!isGameActive) {
      console.warn('[TradingView] Game is not active');
      alert('Duel is not active');
      return;
    }

    if (!playerState) {
      console.warn('[TradingView] Player state not initialized');
      alert('Player state not initialized. Please wait...');
      return;
    }

    if (!account) {
      console.warn('[TradingView] No account connected');
      alert('Please connect your wallet to swap');
      return;
    }
    
    const amount = parseFloat(swapAmount);
    if (isNaN(amount) || amount <= 0) {
      alert('Please enter a valid amount');
      return;
    }

    // Check balance - use real wallet balance for APT, mock service for others
    let hasEnoughBalance = false;
    let currentBalance = 0;
    
    if (tokenIn.symbol === 'APT') {
      // Use real wallet balance for APT
      if (walletBalance === null) {
        alert('Loading wallet balance... Please wait.');
        return;
      }
      currentBalance = walletBalance;
      hasEnoughBalance = walletBalance >= amount;
      console.log('[TradingView] APT balance check (real wallet)', {
        walletBalance,
        amount,
        hasEnoughBalance,
      });
    } else {
      // Use mock service balance for other tokens
      const position = playerState.currentPositions.get(tokenIn.address);
      const amountInBaseUnits = amount * Math.pow(10, tokenIn.decimals);
      currentBalance = position ? position.amount / Math.pow(10, tokenIn.decimals) : 0;
      hasEnoughBalance = position ? position.amount >= amountInBaseUnits : false;
      
      console.log('[TradingView] Balance check (mock service)', {
        position: position ? {
          amount: position.amount,
          token: position.token.symbol,
        } : null,
        amountInBaseUnits,
        hasEnoughBalance,
      });
    }
    
    // For USDC, we allow the swap to proceed even if balance check fails
    // The balance is tracked in the mock service and will be validated during swap execution
    if (!hasEnoughBalance && tokenIn.symbol === 'APT') {
      alert(`Insufficient ${tokenIn.symbol} balance. You have ${currentBalance.toFixed(6)} ${tokenIn.symbol}, trying to swap ${amount} ${tokenIn.symbol}`);
      return;
    }
    
    // For zUSDC, proceed with swap (balance is tracked in mock service)
    if (!hasEnoughBalance && tokenIn.symbol === 'zUSDC') {
      console.warn(`[TradingView] zUSDC balance check failed, but proceeding with swap. Balance: ${currentBalance.toFixed(6)}, Amount: ${amount}`);
      // Continue with swap - the mock service will handle validation
    }
    
    const amountInBaseUnits = amount * Math.pow(10, tokenIn.decimals);

    try {
      setIsSwapping(true);
      console.log('[TradingView] Starting swap process...');
      
      // Execute REAL Liquidswap swap on-chain
      console.log('[TradingView] Executing Liquidswap swap...', {
        tokenIn: tokenIn.symbol,
        tokenOut: tokenOut.symbol,
        amount,
      });
      
      const swapResult = await executeLiquidswapSwap(
        account,
        tokenIn.symbol as 'APT' | 'zUSDC',
        tokenOut.symbol as 'APT' | 'zUSDC',
        amount
      );
      
      console.log('[TradingView] ✅ Real Liquidswap swap executed on-chain!', swapResult);
      
      // Report swap to backend for leaderboard tracking
      await reportSwapExecuted(playerAddress, duelId);
      
      // Record trade for duel P&L tracking
      await recordDuelTrade(duelId, {
        playerAddress,
        tokenIn: tokenIn.symbol,
        tokenOut: tokenOut.symbol,
        amountIn: amount,
        amountOut: swapResult.amountOut,
        timestamp: Math.floor(Date.now() / 1000),
        txHash: swapResult.transactionHash,
      });
      
      // Also update mock service for P&L tracking
      console.log('[TradingView] Updating mock service for P&L tracking...');
      await decibelSwapService.executeSwap(
        duelId,
        playerAddress,
        tokenIn.symbol,
        tokenOut.symbol,
        amountInBaseUnits,
        swapResult.transactionHash
      );
      
      // Update states - this will refresh the balance display
      const updatedState = decibelSwapService.getPlayerState(duelId, playerAddress);
      if (updatedState) {
        console.log('[TradingView] Updated player state after swap:', {
          positions: Array.from(updatedState.currentPositions.entries()).map(([addr, pos]) => ({
            address: addr,
            token: pos.token.symbol,
            amount: pos.amount / Math.pow(10, pos.token.decimals),
          })),
        });
        setPlayerState(updatedState);
      }
      
      // Clear swap amount
      setSwapAmount('');
      
      alert(`Swap successful! Transaction: ${swapResult.transactionHash.slice(0, 10)}...`);
    } catch (error: any) {
      console.error('[TradingView] Swap error:', error);
      console.error('[TradingView] Error stack:', error.stack);
      alert(error.message || 'Swap failed. Check console for details.');
    } finally {
      setIsSwapping(false);
    }
  };

  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
      return `${hours}h ${mins}m ${secs}s`;
    }
    return `${mins}m ${secs}s`;
  };

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const getTokenBalance = (token: SwapToken): number => {
    // For APT, use real wallet balance
    if (token.symbol === 'APT' && walletBalance !== null) {
      return walletBalance;
    }
    
    // For zUSDC, use real wallet balance if available
    if (token.symbol === 'zUSDC' && usdcBalance !== null) {
      return usdcBalance;
    }
    
    // Fallback to mock service balance (should align if all trades tracked)
    if (!playerState) {
      return 0;
    }
    
    // Get the canonical token from SUPPORTED_TOKENS to ensure address consistency
    // This ensures we use the same address that was used when creating positions
    const canonicalToken = SUPPORTED_TOKENS.find(t => t.symbol === token.symbol);
    const lookupAddress = canonicalToken?.address || token.address;
    
    // Try to find position by canonical address first
    let position = playerState.currentPositions.get(lookupAddress);
    
    // If not found, try to find by symbol (fallback for address mismatch)
    // This handles cases where the address might have changed or there's a mismatch
    if (!position) {
      for (const [addr, pos] of playerState.currentPositions.entries()) {
        if (pos.token.symbol === token.symbol) {
          console.warn(`[getTokenBalance] Address mismatch for ${token.symbol}. Stored: ${addr}, Looking for: ${lookupAddress}. Using position by symbol.`);
          position = pos;
          break;
        }
      }
    }
    
    if (!position) {
      return 0;
    }
    
    const balance = position.amount / Math.pow(10, position.token.decimals);
    return balance;
  };

  const getMaxAmount = (): number => {
    return getTokenBalance(tokenIn);
  };

  const handleMaxClick = () => {
    setSwapAmount(getMaxAmount().toFixed(6));
  };

  return (
    <div className="w-full max-w-7xl mx-auto p-8 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex justify-between items-center glass-card p-6">
        <div className="space-y-2">
          <h2 className="text-3xl font-bold text-white">
            Trading Battle
          </h2>
          <p className="text-white/60 font-mono text-sm">
            {formatAddress(playerAddress)} vs {formatAddress(opponentAddress)}
          </p>
        </div>
        <div className="text-right glass-card px-6 py-4 border border-cyberpunk-primary/30">
          <div className={`text-4xl font-mono font-bold ${timeRemaining < 10 ? 'text-cyberpunk-secondary animate-pulse' : 'text-cyberpunk-primary'}`}>
            {formatTime(timeRemaining)}
          </div>
          <div className="text-xs text-white/60 mt-1">Time Remaining</div>
        </div>
      </div>

      {/* Player P&L Comparison - From swaps made in our platform during this duel */}
      <div className="grid grid-cols-2 gap-4">
        <div className="glass-card p-6 border border-cyberpunk-primary/20">
          <div className="flex items-center justify-between mb-2">
            <div className="text-white/60 text-sm">You</div>
            <div className="text-cyberpunk-primary text-xs">Platform Trades</div>
          </div>
          <div className={`text-3xl font-bold ${playerState && playerState.pnlPercent >= 0 ? 'text-cyberpunk-primary' : 'text-cyberpunk-secondary'}`}>
            {playerState ? `${playerState.pnlPercent >= 0 ? '+' : ''}${playerState.pnlPercent.toFixed(2)}%` : '0.00%'}
          </div>
          <div className="text-white/40 text-xs mt-1">
            {platformSwaps.filter(s => s.playerAddress.toLowerCase() === playerAddress.toLowerCase()).length} swaps in this duel
          </div>
        </div>
        <div className="glass-card p-6 border border-white/10">
          <div className="flex items-center justify-between mb-2">
            <div className="text-white/60 text-sm">Opponent</div>
            <div className="text-cyberpunk-primary text-xs">Platform Trades</div>
          </div>
          <div className={`text-3xl font-bold ${opponentState && opponentState.pnlPercent >= 0 ? 'text-cyberpunk-primary' : 'text-cyberpunk-secondary'}`}>
            {opponentState ? `${opponentState.pnlPercent >= 0 ? '+' : ''}${opponentState.pnlPercent.toFixed(2)}%` : '0.00%'}
          </div>
          <div className="text-white/40 text-xs mt-1">
            {platformSwaps.filter(s => s.playerAddress.toLowerCase() === opponentAddress.toLowerCase()).length} swaps in this duel
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="glass-card p-6 border border-cyberpunk-primary/20">
        <div className="flex justify-between items-center mb-4">
          <div className="text-white/60 text-sm">
            P&L Performance (%)
          </div>
        </div>
        <div ref={chartContainerRef} className="w-full rounded-lg overflow-hidden" style={{ height: '400px' }} />
      </div>

      {/* Swap Interface */}
      <div className="glass-card p-6 border border-cyberpunk-primary/20">
        <div className="text-white font-semibold mb-4">Swap Tokens</div>
        
        <div className="space-y-4">
          {/* Token In */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-white/60 text-sm">From</label>
              <span className="text-white/40 text-xs">
                Balance: {getTokenBalance(tokenIn).toFixed(6)} {tokenIn.symbol}
              </span>
            </div>
            <div className="flex gap-2">
              <select
                value={tokenIn.symbol}
                onChange={(e) => {
                  const token = AVAILABLE_TOKENS.find(t => t.symbol === e.target.value)!;
                  setTokenIn(token);
                  if (token.symbol === tokenOut.symbol) {
                    // Swap tokens if same
                    setTokenOut(tokenIn);
                  }
                }}
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-cyberpunk-primary"
                disabled={!isGameActive}
              >
                {AVAILABLE_TOKENS.map(token => (
                  <option key={token.symbol} value={token.symbol}>{token.symbol}</option>
                ))}
              </select>
              <input
                type="number"
                value={swapAmount}
                onChange={(e) => setSwapAmount(e.target.value)}
                placeholder="0.0"
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-cyberpunk-primary"
                disabled={!isGameActive || isSwapping}
              />
              <button
                onClick={handleMaxClick}
                className="px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white/80 hover:bg-white/10 text-sm"
                disabled={!isGameActive}
              >
                MAX
              </button>
            </div>
          </div>

          {/* Swap Arrow */}
          <div className="flex justify-center">
            <button
              onClick={() => {
                setTokenIn(tokenOut);
                setTokenOut(tokenIn);
              }}
              className="p-2 text-cyberpunk-primary hover:bg-white/5 rounded-lg transition-colors"
              disabled={!isGameActive}
            >
              ⇅
            </button>
          </div>

          {/* Token Out */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-white/60 text-sm">To</label>
              <span className="text-white/40 text-xs">
                Balance: {getTokenBalance(tokenOut).toFixed(6)} {tokenOut.symbol}
              </span>
            </div>
            <select
              value={tokenOut.symbol}
              onChange={(e) => {
                const token = AVAILABLE_TOKENS.find(t => t.symbol === e.target.value)!;
                setTokenOut(token);
                if (token.symbol === tokenIn.symbol) {
                  setTokenIn(tokenOut);
                }
              }}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-cyberpunk-primary"
              disabled={!isGameActive}
            >
              {AVAILABLE_TOKENS.filter(t => t.symbol !== tokenIn.symbol).map(token => (
                <option key={token.symbol} value={token.symbol}>{token.symbol}</option>
              ))}
            </select>
          </div>

          {/* Swap Button */}
          <button
            onClick={(e) => {
              e.preventDefault();
              console.log('[TradingView] Swap button clicked');
              handleSwap();
            }}
            disabled={!isGameActive || isSwapping || !swapAmount || parseFloat(swapAmount) <= 0 || !account}
            className="w-full btn-primary py-4 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSwapping ? (
              <span className="flex items-center justify-center gap-2">
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-black border-t-transparent"></div>
                Swapping...
              </span>
            ) : !account ? (
              'Connect Wallet'
            ) : (
              'Swap'
            )}
          </button>
        </div>
      </div>

      {/* Recent Swaps - Made through our platform during this duel */}
      <div className="glass-card p-6 border border-white/10">
        <div className="flex items-center justify-between mb-4">
          <div className="text-white font-semibold">Recent Swaps</div>
          <div className="text-cyberpunk-primary text-xs">This duel only</div>
        </div>
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {platformSwaps.length === 0 ? (
            <div className="text-white/40 text-sm text-center py-4">
              No swaps made in this duel yet
              <div className="text-xs mt-1">Swaps made outside this duel are not counted</div>
            </div>
          ) : (
            platformSwaps.slice(0, 10).map(swap => {
              const isPlayer = swap.playerAddress.toLowerCase() === playerAddress.toLowerCase();
              
              return (
                <div
                  key={swap.id}
                  className={`flex justify-between items-center p-3 rounded-lg ${
                    isPlayer ? 'bg-cyberpunk-primary/10' : 'bg-white/5'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${isPlayer ? 'bg-cyberpunk-primary' : 'bg-white/40'}`}></div>
                    <div>
                      <div className="text-white text-sm font-medium">
                        {isPlayer ? 'You' : 'Opponent'}
                      </div>
                      <div className="text-white/40 text-xs">
                        {swap.tokenIn.symbol} → {swap.tokenOut.symbol}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-sm font-semibold ${swap.pnlUSD >= 0 ? 'text-cyberpunk-primary' : 'text-cyberpunk-secondary'}`}>
                      {swap.pnlUSD >= 0 ? '+' : ''}${swap.pnlUSD.toFixed(2)}
                    </div>
                    <div className="text-white/40 text-xs">
                      {new Date(swap.timestamp * 1000).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Game Status */}
      {!isGameActive && (
        <div className="glass-card p-6 border border-cyberpunk-primary/30 text-center">
          {duelWinner ? (
            <div className="space-y-2">
              <div className="text-3xl font-bold text-cyberpunk-primary animate-bounce">
                {duelWinner.toLowerCase() === playerAddress.toLowerCase() ? '🏆 YOU WON! 🏆' : '💀 YOU LOST 💀'}
              </div>
              <div className="text-white/80">
                {duelWinner.toLowerCase() === playerAddress.toLowerCase() 
                  ? `Congratulations! You've won the pot.` 
                  : 'Better luck next time.'}
              </div>
              <div className="text-sm text-white/40 font-mono mt-2">
                Winner: {formatAddress(duelWinner)}
              </div>
            </div>
          ) : hasReportedPnL ? (
            <div className="space-y-2">
              <div className="text-2xl font-bold text-white">🏁 Duel Ended</div>
              <div className="text-white/60 flex items-center justify-center gap-2">
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white/20 border-t-white/60"></div>
                Waiting for referee resolution...
              </div>
            </div>
          ) : (
            <div className="text-white/60">Reporting P&L...</div>
          )}
        </div>
      )}
    </div>
  );
}
