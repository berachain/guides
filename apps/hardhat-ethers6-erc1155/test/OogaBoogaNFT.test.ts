// Imports
// ========================================================
import { expect } from "chai";
import { ethers } from "hardhat";

// Tests
// ========================================================
describe("OogaBoogaNFT", function () {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  async function deployFixture() {
    // Contracts are deployed using the first signer/account by default
    const [owner, otherAccount] = await ethers.getSigners();

    const Contract = await ethers.getContractFactory("OogaBoogaNFT");
    const contract = await Contract.deploy("https://someurl.com", owner);

    return { contract, owner, otherAccount };
  }

  /**
   *
   */
  describe("Deployment", function () {
    /**
     *
     */
    it("Should deploy with correct owner", async function () {
      // Setup
      const { owner, contract } = await deployFixture();

      // Init + Expectations
      expect(await contract.owner()).to.equal(owner.address);
    });

    /**
     *
     */
    it("Should deploy with correct uri", async function () {
      // Setup
      const { contract } = await deployFixture();

      // Init + Expectations
      expect(await contract.uri(0)).to.equal("https://someurl.com");
    });

    // @TODO: Add more tests
  });
});
