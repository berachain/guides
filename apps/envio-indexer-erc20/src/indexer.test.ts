import { describe, it } from "vitest";
import { createTestIndexer, type Account, TestHelpers } from "envio";

const { Addresses } = TestHelpers;

describe("Transfers", () => {
  it("Transfer subtracts the from account balance and adds to the to account balance", async (t) => {
    const indexer = createTestIndexer();

    const userAddress1 = Addresses.mockAddresses[0]!;
    const userAddress2 = Addresses.mockAddresses[1]!;

    const mockAccountEntity: Account = {
      id: userAddress1,
      balance: 5n,
    };

    indexer.Account.set(mockAccountEntity);

    await indexer.process({
      chains: {
        80094: {
          simulate: [
            {
              contract: "ERC20",
              event: "Transfer",
              params: {
                from: userAddress1,
                to: userAddress2,
                value: 3n,
              },
            },
          ],
        },
      },
    });

    const account1 = await indexer.Account.getOrThrow(userAddress1);
    const account2 = await indexer.Account.getOrThrow(userAddress2);

    t.expect(
      { from: account1.balance, to: account2.balance },
      "Transfer of 3 should move balance from userAddress1 (5 → 2) to userAddress2 (0 → 3)",
    ).toEqual({ from: 2n, to: 3n });
  });
});
