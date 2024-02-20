"use client";

// Imports
// ========================================================
import { useAccount } from "wagmi";

// Main Page
// ========================================================
export default function Account() {
  // Hooks
  const { isConnected } = useAccount();

  // Render
  return (
    <section className="pb-6 mb-6 border-zinc-700 border-b">
      <>
        <h2>Account Connection</h2>
        {isConnected ? (
          <div>
            <span className="dot green"></span>
            Connected
          </div>
        ) : (
          <div>
            <span className="dot red"></span>
            Account NOT Connected
          </div>
        )}
      </>
    </section>
  );
}
