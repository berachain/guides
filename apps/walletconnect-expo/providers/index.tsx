// Imports
// ========================================================
import WagmiProvider from "./wagmi";

// Root Provider
// ========================================================
export default function RootProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return <WagmiProvider>{children}</WagmiProvider>;
}
