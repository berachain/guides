"use client";

// Imports
// ========================================================
import { useAccount } from "wagmi";
import ClientOnly from "../ClientOnly";

// Main Page
// ========================================================
export default function Account() {
  // Hooks
  const { isConnected } = useAccount();

  // Render
  return (
    <section>
      <ClientOnly>
        <>
          <h2>Account Connection</h2>
          {isConnected ? 'Connected' : 'Account NOT Connected'}
        </>
      </ClientOnly>
    </section>
  )
};
