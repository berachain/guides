import { jsx as _jsx } from "react/jsx-runtime";
import React from "react";
import ReactDOM from "react-dom/client";
import { BerachainArtio } from "@particle-network/chains";
import { AuthCoreContextProvider } from "@particle-network/auth-core-modal";
import App from "./App";
import("buffer").then(({ Buffer }) => {
    window.Buffer = Buffer;
});
ReactDOM.createRoot(document.getElementById("root")).render(_jsx(React.StrictMode, { children: _jsx(AuthCoreContextProvider, { options: {
            projectId: "YOUR_PROJECT_ID_HERE",
            clientKey: "YOUR_CLIENT_KEY_HERE",
            appId: "YOUR_APP_ID_HERE",
            erc4337: {
                name: "SIMPLE",
                version: "1.0.0",
            },
            wallet: {
                visible: true,
                customStyle: {
                    supportChains: [BerachainArtio],
                },
            },
        }, children: _jsx(App, {}) }) }));
