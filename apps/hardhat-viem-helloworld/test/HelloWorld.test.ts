// Imports
// ========================================================
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";

// Tests
// ========================================================
describe("HelloWorld", async function () {
  const { viem } = await network.create();
  /**
   *
   */
  describe("Deployment", function () {
    /**
     *
     */
    it("Should deploy with original message", async function () {
      // Setup
      const contract = await viem.deployContract("HelloWorld", [
        "Test Message",
      ]);

      // Init + Expectations
      assert.equal(await contract.read.getGreeting(), "Test Message");
    });

    /**
     *
     */
    it("Should set a new message", async function () {
      // Setup
      const contract = await viem.deployContract("HelloWorld", [
        "Test Message",
      ]);

      // Init
      await contract.write.setGreeting(["Hello There"]);

      // Expectations
      assert.equal(await contract.read.getGreeting(), "Hello There");
    });
  });
});
