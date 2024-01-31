// Imports
// ========================================================
import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";

// Tests
// ========================================================
describe("HelloWorld", function () {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  async function deployFixture() {
    // Contracts are deployed using the first signer/account by default
    const [owner, otherAccount] = await hre.viem.getWalletClients();

    const contract = await hre.viem.deployContract("HelloWorld", ["Test Message"]);
    const publicClient = await hre.viem.getPublicClient();

    return {
      owner,
      otherAccount,
      publicClient,
      contract
    };
  }

  /**
   * 
   */
  describe("Deployment", function () {
    /**
     * 
     */
    it("Should deploy with original message", async function () {
      // Setup
      const { contract } = await loadFixture(deployFixture);

      // Init + Expectations
      expect(await contract.read.getGreeting()).to.equal("Test Message");
    });

    /**
     * 
     */
    it("Should set a new message", async function () {
      // Setup
      const { contract, owner } = await loadFixture(deployFixture);

      // Init
      await contract.write.setGreeting(["Hello There"])

      // Expectations
      expect(await contract.read.getGreeting()).to.equal("Hello There");
    });
  });
});
