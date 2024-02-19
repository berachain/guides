import React from 'react';
import ReactDOM from 'react-dom/client';
import { BerachainArtio } from '@particle-network/chains';
import { AuthCoreContextProvider } from '@particle-network/auth-core-modal';
import App from './App';

import('buffer').then(({ Buffer }) => {
  window.Buffer = Buffer;
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AuthCoreContextProvider
      options={{
       projectId: "YOUR_PROJECT_ID_HERE", // Replace YOUR_PROJECT_ID_HERE with the actual project ID
    clientKey: "YOUR_CLIENT_KEY_HERE", // Replace YOUR_CLIENT_KEY_HERE with the actual client key
    appId: "YOUR_APP_ID_HERE", // Replace YOUR_APP_ID_HERE with the actual app ID
        erc4337: {
          name: "SIMPLE",
          version: "1.0.0",
        },
        wallet: {
          visible: true,
          customStyle: {
            supportChains: [BerachainArtio],
          }
        }
      }}
  >
      <App />
    </AuthCoreContextProvider>
  </React.StrictMode>
)
