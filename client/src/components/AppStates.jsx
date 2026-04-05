import React from 'react';
import { WifiOff, AlertCircle } from 'lucide-react';

export function GlobalBanners({ isOffline, websocketError }) {
  if (isOffline) {
    return (
      <div className="bg-amber-500 text-white px-4 py-2 flex items-center justify-center gap-2 font-medium text-sm w-full border-b border-amber-600 fixed top-0 z-[100]" role="alert">
        <WifiOff size={16} />
        <span>You are currently offline. Check your network connection.</span>
      </div>
    );
  }

  if (websocketError) {
    return (
      <div className="bg-red-500 text-white px-4 py-2 flex items-center justify-center gap-2 font-medium text-sm w-full border-b border-red-600 fixed top-0 z-[100]" role="alert">
        <AlertCircle size={16} />
        <span>Disconnected from the Federated Node. Attempting to reconnect...</span>
      </div>
    );
  }
  return null;
}
