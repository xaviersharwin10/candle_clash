import { useState } from 'react';

interface TopUpModalProps {
  isOpen: boolean;
  onClose: () => void;
  userAddress?: string;
}

export default function TopUpModal({ isOpen, onClose, userAddress }: TopUpModalProps) {
  const [amount, setAmount] = useState('0.1');

  if (!isOpen) return null;

  const handlePanoraLink = () => {
    // Open Panora exchange with pre-filled parameters
    const panoraUrl = `https://app.panora.exchange/?to=APT${userAddress ? `&recipient=${userAddress}` : ''}`;
    window.open(panoraUrl, '_blank');
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="glass-card p-8 max-w-md w-full mx-4 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-white">
            Top Up APT
          </h2>
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white transition-colors text-2xl w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/5"
          >
            ×
          </button>
        </div>

        <div className="space-y-5">
          <div>
            <label className="block text-white/80 text-sm font-medium mb-2">
              Amount (APT)
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              step="0.01"
              min="0.01"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white text-base font-mono focus:outline-none focus:border-cyberpunk-primary focus:ring-1 focus:ring-cyberpunk-primary transition-all"
              placeholder="0.1"
            />
          </div>

          <div className="glass-card p-4">
            <div className="text-sm text-cyberpunk-primary font-semibold mb-2">Powered by Panora</div>
            <div className="text-xs text-white/60 leading-relaxed">
              Panora provides seamless cross-chain swaps. You'll be redirected to complete your swap.
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={handlePanoraLink}
              className="btn-primary flex-1"
            >
              Open Panora Exchange
            </button>
            <button
              onClick={onClose}
              className="btn-secondary"
            >
              Cancel
            </button>
          </div>

          <div className="text-xs text-white/50 text-center glass-card p-3">
            💡 After swapping, return here and refresh to see your updated balance
          </div>
        </div>
      </div>
    </div>
  );
}

