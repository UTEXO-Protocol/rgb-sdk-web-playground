import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Proxy all esplora-api.utexo.com requests through Vite dev server to avoid CORS.
// The UTEXOWallet SDK hardcodes the URL so we intercept at the fetch level.
// The WASM binding passes a pre-built Request object (not a string), so we must
// reconstruct it properly — Request.body is a ReadableStream and cannot be passed
// to new Request() without consuming it. We use arrayBuffer() to copy the body.
const _fetch = window.fetch.bind(window);
window.fetch = (input, init): Promise<Response> => {
  const url = typeof input === 'string' ? input
    : input instanceof URL ? input.href
    : (input as Request).url;

  if (!url.startsWith('https://esplora-api.utexo.com')) {
    return _fetch(input, init);
  }

  const proxied = url.replace('https://esplora-api.utexo.com', window.location.origin + '/utexo-api');

  // Simple case: caller passed a URL string (or URL object) — just rewrite it
  if (typeof input === 'string' || input instanceof URL) {
    return _fetch(proxied, init);
  }

  // WASM case: caller passed a Request object — extract body bytes first, then rebuild
  const req = input as Request;
  if (!req.body || req.method === 'GET' || req.method === 'HEAD') {
    return _fetch(new Request(proxied, req), init);
  }
  return req.arrayBuffer().then((body) =>
    _fetch(new Request(proxied, {
      method: req.method,
      headers: req.headers,
      body,
      mode: req.mode,
      credentials: req.credentials,
      cache: req.cache,
      redirect: req.redirect,
      referrer: req.referrer,
      integrity: req.integrity,
      keepalive: req.keepalive,
      signal: req.signal,
    }), init)
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
