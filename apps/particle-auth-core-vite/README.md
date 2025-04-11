<div align="center">
  <a href="https://berachain.com/">
    <img src="ipfs://QmW2xrDkSqBB7qgftp5PUecEGg4zwUBJgSN45CaR7CKJMr" />
  </a>
  <h3>
    Particle Network Wallet-as-a-Service on Berachain
  </h3>
</div>

⚡️ Demo application showcasing utilization of Particle Network's Wallet-as-a-Service ([Particle Auth Core](https://docs.particle.network/developers/auth-service/core/web) in this case) on Berachain. This application facilitates social login and the execution of a sample (0.001 BERA or 1 HONEY) burn transaction alongside.

Built using **Particle Auth Core**, **TypeScript**

## 🔑 Particle Auth Core

Particle Auth Core, a component of Particle Network's Wallet-as-a-Service, enables seamless onboarding to an application-embedded MPC-TSS/AA wallet facilitated by social login, such as Google, GitHub, email, phone number, etc. - as an alternative to Particle Auth, the Auth Core SDK comes with more control over the modal itself, application-embedded popups rather than redirects, and so on.

##

![](https://i.imgur.com/28BP5gj.png)

##

<p align="center">
  <a href="https://vercel.com/new/clone?repository-url=https://github.com/TABASCOatw/particle-berachain-demo&env=REACT_APP_PROJECT_ID&env=REACT_APP_CLIENT_KEY&env=REACT_APP_APP_ID&envDescription=Head%20over%20to%20the%20Particle%20dashboard%20to%20retrieve%20the%20above%20keys.&envLink=https%3A%2F%2Fdashboard.particle.network">
    <img src="https://vercel.com/button" alt="Deploy with Vercel"/>
  </a>
</p>

##

👉 Try the demo: https://core-demo.particle.network

👉 Learn more about Particle Network: https://particle.network

## 🛠️ Quickstart

### Clone this repository

```
git clone https://github.com/TABASCOatw/particle-berachain-demo.git
```

### Install dependencies

```
yarn install
```

OR

```
npm install
```

### Set environment variables

This project requires a number of keys from Particle Network to be defined in `.env`. The following should be defined:

- `REACT_APP_APP_ID`, the ID of the corresponding application in your [Particle Network dashboard](https://dashboard.particle.network/#/applications).
- `REACT_APP_PROJECT_ID`, the ID of the corresponding project in your [Particle Network dashboard](https://dashboard.particle.network/#/applications).
- `REACT_APP_CLIENT_KEY`, the client key of the corresponding project in your [Particle Network dashboard](https://dashboard.particle.network/#/applications).

### Start the project

```
npm run start
```

OR

```
yarn start
```
