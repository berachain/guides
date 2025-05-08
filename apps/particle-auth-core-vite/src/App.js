import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from "react";
import { BerachainArtio } from "@particle-network/chains";
import { AAWrapProvider, SendTransactionMode, SmartAccount, } from "@particle-network/aa";
import { useEthereum, useConnect, useAuthCore, } from "@particle-network/auth-core-modal";
import { ethers } from "ethers";
import { notification } from "antd";
import "./App.css";
const App = () => {
    const { provider } = useEthereum();
    const { connect, disconnect } = useConnect();
    const { userInfo } = useAuthCore();
    const [balance, setBalance] = useState(null);
    const smartAccount = new SmartAccount(provider, {
        projectId: "YOUR_PROJECT_ID_HERE",
        clientKey: "YOUR_CLIENT_KEY_HERE",
        appId: "YOUR_APP_ID_HERE",
        aaOptions: {
            simple: [{ chainId: BerachainArtio.id, version: "1.0.0" }],
        },
    });
    const customProvider = new ethers.providers.Web3Provider(new AAWrapProvider(smartAccount, SendTransactionMode.Gasless), "any");
    useEffect(() => {
        if (userInfo) {
            fetchBalance();
        }
    }, [userInfo]);
    const fetchBalance = async () => {
        const address = await smartAccount.getAddress();
        const balanceResponse = await customProvider.getBalance(address);
        setBalance(ethers.utils.formatEther(balanceResponse));
    };
    const handleLogin = async (authType) => {
        if (!userInfo) {
            await connect({
                socialType: authType,
                chain: BerachainArtio,
            });
        }
    };
    const executeUserOp = async () => {
        const signer = customProvider.getSigner();
        const tx = {
            to: "0x000000000000000000000000000000000000dEaD",
            value: ethers.utils.parseEther("0.001"),
        };
        const txResponse = await signer.sendTransaction(tx);
        const txReceipt = await txResponse.wait();
        notification.success({
            message: "Transaction Successful",
            description: (_jsxs("div", { children: ["Transaction Hash:", " ", _jsx("a", { href: `https://artio.beratrail.io/tx/${txReceipt.transactionHash}`, target: "_blank", rel: "noopener noreferrer", children: txReceipt.transactionHash })] })),
        });
    };
    const executeUserOpHONEY = async () => {
        const signer = customProvider.getSigner();
        const tokenContract = new ethers.Contract("0x7EeCA4205fF31f947EdBd49195a7A88E6A91161B", ["function transfer(address to, uint256 amount)"], signer);
        const txResponse = await tokenContract.transfer("0x000000000000000000000000000000000000dEaD", ethers.utils.parseEther("1"));
        const txReceipt = await txResponse.wait();
        notification.success({
            message: "Transaction Successful",
            description: (_jsxs("div", { children: ["Transaction Hash:", " ", _jsx("a", { href: `https://artio.beratrail.io/tx/${txReceipt.transactionHash}`, target: "_blank", rel: "noopener noreferrer", children: txReceipt.transactionHash })] })),
        });
    };
    return (_jsxs("div", { className: "App", children: [_jsxs("div", { className: "logo-section", children: [_jsx("img", { src: "https://i.imgur.com/EerK7MS.png", alt: "Logo 1", className: "logo logo-big" }), _jsx("img", { src: "https://i.imgur.com/OdR3YLW.png", alt: "Logo 2", className: "logo" })] }), !userInfo ? (_jsxs("div", { className: "login-section", children: [_jsxs("button", { className: "sign-button google-button", onClick: () => handleLogin("google"), children: [_jsx("img", { src: "https://i.imgur.com/nIN9P4A.png", alt: "Google", className: "icon" }), "Sign in with Google"] }), _jsxs("button", { className: "sign-button twitter-button", onClick: () => handleLogin("twitter"), children: [_jsx("img", { src: "https://i.imgur.com/afIaQJC.png", alt: "Twitter", className: "icon" }), "Sign in with X"] }), _jsx("button", { className: "sign-button other-button", onClick: () => handleLogin(""), children: _jsx("img", { src: "https://i.imgur.com/VRftF1b.png", alt: "Twitter", className: "icon" }) })] })) : (_jsxs("div", { className: "profile-card", children: [_jsx("h2", { children: userInfo.name }), _jsxs("div", { className: "balance-section", children: [_jsxs("small", { children: [balance, " BERA"] }), _jsx("button", { className: "sign-message-button", onClick: executeUserOp, children: "Burn 0.001 $BERA" }), _jsx("button", { className: "sign-message-button honey", onClick: executeUserOpHONEY, children: "Burn 1 $HONEY" }), _jsx("button", { className: "disconnect-button", onClick: () => disconnect(), children: "Logout" })] })] }))] }));
};
export default App;
