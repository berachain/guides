const { expect } = require("chai");

describe("FaucetContract", function () {
  let FaucetContract;
  let faucetContract;
  let owner;

  beforeEach(async function () {
    // Get the factory and deployment of the contract
    FaucetContract = await ethers.getContractFactory("Faucet");
    faucetContract = await FaucetContract.deploy(ethers.parseEther("0.05"));
    // Get the owner's signer
    [owner] = await ethers.getSigners();
  });

  it("should receive 0.1 ETH and verify balance", async function () {
    // Get the address of the deployed contract
    const contractAddress = faucetContract.target;
    console.log("Contract address:", faucetContract.target);

    // Send 0.1 ETH to the contract by calling the donate function
    await faucetContract.donate({ value: ethers.parseEther("0.1") });

    // Check if the contract's balance is correct
    const balance = await ethers.provider.getBalance(contractAddress);
    expect(balance).to.equal(ethers.parseEther("0.1"));
  });
});

// npx hardhat test ./test/faucet_contract_test.js
