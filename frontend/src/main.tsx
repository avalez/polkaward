import React from 'react';
import ReactDOM from 'react-dom/client';
import { UseInkProvider } from 'useink';
import { Development } from 'useink/chains';
import { NotificationsProvider } from 'useink/notifications';
import App from './App.tsx';
import './Global.css';
import metadata from './assets/polkaward.json';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <UseInkProvider
      config={{
        dappName: metadata.contract.name,
        chains: [Development],
        caller: {
          default: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
        },
      }}
    >
      <NotificationsProvider>
        <App />
      </NotificationsProvider>
    </UseInkProvider>
  </React.StrictMode>,
);
