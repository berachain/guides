# Berachain Expo WalletConnect

An example of Berachain being used with WalletConnect and Expo.

## Requirements

> **NOTE:**

- Node v20.11.0
- pnpm or npm
- iOS Simulator - See [iOS Simulator Configuration](#ios-simulator-configuration)
- Android - (coming soon)


## Getting Started

This will walk through the steps to get up and running.

### 1 - Install Dependencies

```bash
# FROM: ./expo-walletconnect

pnpm install;
# or npm install;
```

### 2 - Get WalletConnect Project ID

Go to [https://cloud.walletconnect.com](https://cloud.walletconnect.com]), sign up for an account, and get a project id.

## iOS Simulator Configuration

If you're on the latest MacOS Sonoma and have XCode installed, chances are you need to have to also download additional simulator run times.

In order to do so, run `XCode` and go to `Window` > `Devices & Simulators`.

Select `Simulator` in the top right, select `Device Type`, and for `OS Version` select `Download more simulator runtimes...`

![XCode Devices & Simulators](./README/xcode-devices-simulators.png)

This will then display a new window to download the latest iOS simulator.

![XCode Platforms Download](./README/xcode-platforms-download-ios.png)




