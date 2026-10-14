#!/usr/bin/env node
// Finnish Learning App — ElevenLabs proxy
// Run: node proxy.js
// Then open: http://localhost:3000

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const PORT  = 3000;

const HTML_FILE = path.join(__dirname, 'finnish-learning.html');

http.createServer((req, res) => {
  // CORS headers for all responses
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, xi-api-key');

  // Preflight
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Proxy ElevenLabs
  if (req.url.startsWith('/elevenlabs/')) {
    const elPath = req.url.replace('/elevenlabs', '');
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      const opts = {
        hostname: 'api.elevenlabs.io',
        path: elPath,
        method: req.method,
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': req.headers['xi-api-key'] || '',
        }
      };
      const proxy = https.request(opts, (elRes) => {
        res.writeHead(elRes.statusCode, { 'Content-Type': elRes.headers['content-type'] || 'application/octet-stream' });
        elRes.pipe(res);
      });
      proxy.on('error', e => { res.writeHead(502); res.end(JSON.stringify({ error: e.message })); });
      if (body) proxy.write(body);
      proxy.end();
    });
    return;
  }

  // Serve the HTML file
  if (req.url === '/' || req.url === '/index.html' || req.url.endsWith('.html')) {
    fs.readFile(HTML_FILE, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  res.writeHead(404); res.end('Not found');

}).listen(PORT, () => {
  console.log('');
  console.log('  ✓ Finnish Learning App running');
  console.log('  → Open: http://localhost:' + PORT);
  console.log('');
  console.log('  ElevenLabs requests are proxied automatically.');
  console.log('  Press Ctrl+C to stop.');
  console.log('');
});
