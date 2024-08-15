# Gelato VRF Jump Start

This repository provides example contracts and instructions for setting up Verifiable Random Function (VRF) on Gelato, utilizing Gelato VRF.

[![Video Walkthrough](https://img.youtube.com/vi/cUPjQYoH2OE/0.jpg)](https://youtu.be/cUPjQYoH2OE)

## Overview

Verifiable Random Function (VRF) is a cryptographic primitive that generates unpredictable random numbers. Integrating VRF into Gelato allows for various decentralized applications (DApps) to leverage secure, on-chain randomness.

This repository includes contracts and configurations necessary for implementing VRF functionality on Gelato, making it easy for developers to integrate random number generation into their projects.

## Requirements

Before beginning, make sure you have the following installed or set up on your computer beforehand.

- nvm or Node `v20.0.0` or greater
- pnpm, yarn, or npm
- Wallet that contains BERA token (for deployment - see the [faucet](https://bartio.faucet.berachain.com/))
- hardhat

## Gelato VRF: `SimpleVRFContract`

Create a `.env` file at the project root and populate it with the following values

```bash
PRIVATE_KEY=<YOUR PRIVATE KEY>
DEDICATED_MSG_SENDER=<YOUR DEDICATED MSG SENDER>
SC_ADDRESS=<smart contract deployed in this guide>
```

```bash
cp .env.example .env
```

To deploy the `SimpleVRFContract`, you'll need to install the dependencies first

```bash
npm install
```

Then run the following hardhat command:

```bash
npx hardhat deploy --network berachain
```

> [!NOTE]  
> Check the deployed addresses for each network in the `deployments/` folder, which is automatically created at the root of the `gelato-vrf/` directory following a deployment.

- **Description**: Contract for using Gelato VRF directly.
- **Contract Address on Berachain**: [0x3E183d1C8fcfdb080e3107f400786f6FA6f30810](https://bartio.beratrail.io/address/0x3E183d1C8fcfdb080e3107f400786f6FA6f30810)
- **Features**:
  - Requests randomness from Gelato VRF.
  - Handles the fulfillment of randomness.

## Create a Gelato VRF Task

Deploying your Gelato VRF instance is a straightforward process. Here's a step-by-step guide to get you started:

### Step 1. Gather Necessary Addresses

Before you begin, make sure you have the address of your requester contract at hand. This will be essential for the deployment process.

### Step 2. Access the VRF Deployment Portal

Navigate to the Gelato [app](https://app.gelato.network/vrf).

### Step 3. Select Deployment Network

Ensure you choose the `Berachain bArtio` network where your VRF requester and receiver contracts are deployed.

### Step 4. Specify the Request Contract

You'll be asked to provide the address of the Request Contract to which the Gelato nodes should respond. Enter the address you gathered in step 1 (in our example: **0x3E183d1C8fcfdb080e3107f400786f6FA6f30810**).

### Step 5. Launch your VRF Instance

Once all details are correctly entered, go ahead and launch your Gelato VRF instance.

![NewTask](./assets/newtask.png)

## Request Randomness

After deploying your contract, proceed to the `.env` file and replace the existing smart contract address with the one specific to your deployment. Regarding our example, you would set it as follows:

```bash
SC_ADDRESS=0x3E183d1C8fcfdb080e3107f400786f6FA6f30810
```

To invoke the randomness request, you can run the `requestRandomness.ts` script:

```bash
npx hardhat run ./scripts/requestRandomness.ts --network berachain
```

This will produce a similar response:

```
Requesting randomness with data: 0x7465737420646174610000000000000000000000000000000000000000000000
Transaction hash: 0x1a33e33970c0c4e89589e863b8833d7da5138a4f13b7cc02da9b2d97863912df
```

## Monitor Execution

After your randomness request has been made, you can monitor and analyze it here:

[Here](https://app.gelato.network/functions/task/0x904a1cdf1d09ec7f237a887bd6924d9116351a329c5f52a64d62bdcb9b9b5568:80084?origin=vrf) is an example task from the app that shows the fullfilled randomness

![Monitoring](./assets/monitoring.png)
