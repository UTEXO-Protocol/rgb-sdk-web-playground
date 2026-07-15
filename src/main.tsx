import React from 'react';
import ReactDOM from 'react-dom/client';
import { configureLogging, LogLevel } from '@utexo/rgb-sdk-core';
import App from './App';
import './index.css';

// The SDK logger defaults to ERROR-only, which silently swallows every VSS
// status line (replication enabled/failed, auto-backup failures, restore
// skips — all info/warn). The demo exists to observe SDK behavior, so log
// everything.
configureLogging(LogLevel.DEBUG);


ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
