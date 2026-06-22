import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

describe("NFT", function () {
  it("deploys the NFT contract", async function () {
    const nft = await ethers.deployContract("NFT");

    expect(await nft.name()).to.equal("NFT Name");
    expect(await nft.symbol()).to.equal("NFT");
  });

  it("mints an NFT to the requested recipient", async function () {
    const [owner] = await ethers.getSigners();
    const nft = await ethers.deployContract("NFT");

    await nft.mint(owner.address);

    expect(await nft.ownerOf(1)).to.equal(owner.address);
  });
});
