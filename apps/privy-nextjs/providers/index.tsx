"use client";

// Imports
// ------------------------------------------------------------
import Privy from "@/providers/privy";
import Query from "@/providers/query";
import Wagmi from "@/providers/wagmi";

// Main Provider
// ------------------------------------------------------------
const RootProvider = ({ children }: { children: React.ReactNode }) => {
  return (
    <>
      <Privy>
        <Query>
          <Wagmi>{children}</Wagmi>
        </Query>
      </Privy>
    </>
  );
};

// Exports
// ------------------------------------------------------------
export default RootProvider;
