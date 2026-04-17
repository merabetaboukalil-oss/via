/**
 * VIA Local Link Agent - V1.5.2 (Windows Connectivity Fix)
 * 
 * INSTALLATION :
 * npm install socket.io-client bonjour-service node-ssdp
 */

import { io } from 'socket.io-client';
import { exec } from 'child_process';
import { promisify } from 'util';
import http from 'http';
import url from 'url';
import os from 'os';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);
const SERVER_URL = 'https://via-dz.onrender.com';
const IPP_PORT = 631;

let localPrinters: any[] = [];

// --- FONCTION POUR OUVRIR LE PARE-FEU ---
async function fixWindowsFirewall() {
  try {
    console.log("[SYSTEM] Tentative d'ouverture du port 631 dans le Pare-feu...");
    const cmd = `PowerShell -Command "Start-Process PowerShell -Verb RunAs -ArgumentList 'New-NetFirewallRule -DisplayName \\"VIA Printer Bridge\\" -Direction Inbound -LocalPort 631 -Protocol TCP -Action Allow'"`;
    await execAsync(cmd);
    return true;
  } catch (e) {
    return false;
  }
}

// ... (logique d'impression et IPP identique à la V1.5.1) ...

function createIppServer() {
  return http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url || '', true);
    
    // API : Fix Firewall
    if (parsedUrl.pathname === '/api/fix-firewall') {
      fixWindowsFirewall().then(success => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: success ? 'ok' : 'error' }));
      });
      return;
    }

    // ... (autres APIs test/sync) ...

    if (req.method === 'POST') {
       // Logique IPP (Inchangée)
    }

    // --- DASHBOARD HTML V1.5.2 ---
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>VIA Agent V1.5.2</title>
          <style>
             /* Styles identiques + section aide */
             .help-box { background: #020617; border: 1px dashed #3b82f6; padding: 20px; border-radius: 8px; margin-top: 30px; }
             .btn-fix { background: #10b981; color: white; padding: 10px 20px; border-radius: 6px; cursor: pointer; border: none; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>VIA Agent <span class="badge">V1.5.2</span></h1>
            
            <!-- Liste des imprimantes -->
            
            <div class="help-box">
              <h3 style="color: #3b82f6; margin-top: 0;">Windows ne trouve pas l'imprimante ?</h3>
              <p>1. <strong>Pare-feu :</strong> Le port 631 doit être ouvert.</p>
              <button class="btn-fix" onclick="fetch('/api/fix-firewall').then(() => alert('Commande envoyée ! Acceptez la demande Windows.'))">Ouvrir le port 631 automatiquement</button>
              
              <p style="margin-top: 20px;">2. <strong>Réglage Windows :</strong> Allez dans <em>"Activer ou désactiver des fonctionnalités Windows"</em> et cochez la case <strong>"Client d'impression par Internet"</strong>.</p>
              
              <p>3. <strong>Ajout manuel :</strong> Si la détection bloque, utilisez cette adresse :<br>
              <code class="url-box">http://${os.hostname()}:631/ipp/print</code></p>
            </div>
          </div>
        </body>
      </html>
    `);
  });
}