/**
 * VIA Local Link Agent - V1.8.9 (Service Stable Pro)
 */

import { io } from 'socket.io-client';
import express from 'express';
import { createServer } from 'http';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execAsync = promisify(exec);
const app = express();
const IPP_PORT = 631;
const DASHBOARD_PORT = 3000;

// On récupère l'ID utilisateur
const AGENT_ID = process.cwd().split(path.sep).pop() || 'rakaim';
const SERVER_URL = 'https://ais-dev-2cprk2z76jl7wd4sldqxdw-372334921409.europe-west2.run.app';

console.log(`\x1b[34m[VIA-AGENT] Initialisation ID: ${AGENT_ID}\x1b[0m`);

let localPrinters: any[] = [];
const socket = io(SERVER_URL, {
  query: { agentId: AGENT_ID, type: 'agent' },
  reconnection: true,
  transports: ['websocket']
});

// --- LOGIQUE DE PAGE DE TEST ---
async function triggerTestPage(printerName?: string) {
  const testContent = `
    ==========================================
    VIA CLOUD PRINTING - PAGE DE TEST
    ==========================================
    Date : ${new Date().toLocaleString()}
    Imprimante : ${printerName}
    Statut : CONNECTE
    Agent : VIA Local Link V1.8.9
    
    Felicitation ! Votre pont d'impression 
    VIA fonctionne correctement.
    ==========================================
  `;
  
  const target = localPrinters.find(p => p.name === printerName)?.name || 
                 localPrinters.find(p => /Canon|HP|Epson|Brother|Samsung|LBP/i.test(p.name))?.name ||
                 localPrinters[0]?.name || 
                 '';
                 
  if (!target) {
    console.error("[LOCAL-DASH] Erreur : Aucune imprimante physique détectée.");
    return;
  }

  console.log(`[LOCAL-DASH] Déclenchement page de test vers -> "${target}"`);
  await sendToPhysicalPrinter(Buffer.from(testContent), target);
}

// --- MOTEUR D'IMPRESSION RÉELLE (FIXÉ POUR CANON R6025) ---
async function sendToPhysicalPrinter(data: Buffer, printerName?: string) {
  try {
    const targetPrinter = printerName || 
                         localPrinters.find(p => /Canon|LBP|HP|LaserJet|InkJet|Epson|Brother|Samsung|Xerox|Lexmark/i.test(p.name))?.name ||
                         localPrinters[0]?.name ||
                         '';

    if (!targetPrinter) {
      console.error("\x1b[31m[PRINT] ERREUR : Aucune imprimante trouvée.\x1b[0m");
      return;
    }

    const tempFile = path.join(os.tmpdir(), `via_job_${Date.now()}.txt`);
    await fs.promises.writeFile(tempFile, data);

    // FIX RADICAL : On n'utilise PLUS print.exe (cause l'erreur R6025 sur Canon)
    // On utilise exclusivement Out-Printer avec le contenu brut
    const safePrinterName = targetPrinter.replace(/'/g, "''");
    const cmd = `PowerShell -Command "Get-Content -LiteralPath '${tempFile}' -Raw | Out-Printer -Name '${safePrinterName}'"`;

    console.log(`[SYSTEM] Envoi vers "${targetPrinter}" sans print.exe...`);
    const { stderr } = await execAsync(cmd);
    
    if (stderr && !stderr.includes('Out-Printer')) {
      console.error(`[PRINT] Erreur : ${stderr}`);
    } else {
      console.log(`\x1b[32m[PRINT] JOB TRANSMIS AU SPOULEUR WINDOWS.\x1b[0m`);
    }
    
    setTimeout(() => fs.unlink(tempFile, () => {}), 10000);
  } catch (err) {
    console.error(`\x1b[31m[PRINT] ERREUR CRITIQUE :\x1b[0m`, err);
  }
}

// --- DASHBOARD LOCAL ---
app.get('/', (req, res) => {
  const localIP = Object.values(os.networkInterfaces())
    .flat()
    .find(i => i?.family === 'IPv4' && !i.internal)?.address || 'localhost';

  res.send(`
    <!DOCTYPE html>
    <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <title>VIA Agent V1.8.9</title>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 40px; background: #0f172a; color: white; line-height: 1.6; }
          .container { max-width: 800px; margin: 0 auto; }
          .badge { background: #3b82f6; padding: 4px 12px; border-radius: 99px; font-size: 0.8em; }
          .printer-card { background: #1e293b; border: 1px solid #334155; padding: 20px; border-radius: 12px; margin-bottom: 12px; }
          .printer-name { font-weight: 600; font-size: 1.1em; color: #f8fafc; }
          .printer-status { font-size: 0.9em; color: #94a3b8; display: flex; align-items: center; gap: 8px; margin-top: 4px; }
          .dot { width: 10px; height: 10px; background: #22c55e; border-radius: 50%; }
          .actions { margin-top: 15px; display: flex; gap: 10px; }
          .btn-test { background: #3b82f6; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 500; font-size: 0.9em; }
          .btn-copy { background: #10b981; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 0.8em; margin-left: 10px; }
          .url-box { background: #000; padding: 15px; border-radius: 8px; font-family: monospace; color: #60a5fa; margin: 15px 0; border: 1px dashed #3b82f6; position: relative; }
          .alert-red { background: #450a0a; border: 2px solid #ef4444; color: #fecaca; padding: 20px; border-radius: 8px; margin: 20px 0; animation: pulse 2s infinite; }
          @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.8; } 100% { opacity: 1; } }
          .step-number { background: #3b82f6; color: white; width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; font-size: 0.8em; margin-right: 8px; }
        </style>
        <script>
          async function doAction(endpoint, body) {
            const btn = event.target;
            const originalText = btn.innerText;
            btn.innerText = "Envoi...";
            btn.disabled = true;
            try {
              const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: body
              });
              const data = await res.json();
              if (data.success) {
                btn.style.background = "#059669";
                btn.innerText = "Envoyé !";
              } else {
                alert("Erreur: " + (data.error || "Inconnue"));
                btn.innerText = originalText;
              }
            } catch (e) {
              alert("Serveur hors ligne");
              btn.innerText = originalText;
            }
            setTimeout(() => { 
                btn.disabled = false; 
                btn.innerText = originalText;
                btn.style.background = "";
            }, 3000);
          }
          function copyText(txt) {
            navigator.clipboard.writeText(txt);
            alert("Copié dans le presse-papier !");
          }
        </script>
      </head>
      <body>
        <div class="container">
          <h1>VIA Agent <span class="badge">V1.8.9</span></h1>
          <p>Statut du Pont : <strong>ACTIF</strong> sur <strong>${os.hostname()}</strong> (${localIP})</p>
          
          <div class="alert-red">
            <h2 style="margin-top: 0; color: #f87171;">⚠️ RÉSOLUTION DU PORT 515 / LPR</h2>
            <p>Windows bloque le port car il croit que c'est une imprimante réseau locale classique.</p>
            <p><strong>NE MODIFIEZ PAS LES PROPRIÉTÉS GRISÉES.</strong> C'est impossible.</p>
            <p style="font-weight: bold;">SOLUTION : Supprimez l'imprimante dans Windows, et utilisez cette commande dans PowerShell (Administrateur) sur le PC client :</p>
            <div style="background: #000; padding: 10px; color: #10b981; font-family: monospace; font-size: 0.85em; border-radius: 6px; margin: 10px 0; cursor: pointer;" onclick="copyText('Add-Printer -ConnectionName \\'http://${localIP}:631/ipp/print\\'')">
              Add-Printer -ConnectionName "http://${localIP}:631/ipp/print"
            </div>
          </div>

          <h2 style="margin-top: 40px; color: #94a3b8; font-size: 1em; text-transform: uppercase; letter-spacing: 1px;">Imprimantes Détectées</h2>
          
          ${localPrinters.length === 0 ? '<p style="color: #64748b;">Recherche d\'imprimantes en cours...</p>' : localPrinters.map(p => `
            <div id="printer-${p.name.replace(/\s+/g, '-')}" class="printer-card">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <span class="printer-name">${p.name}</span>
                  <div class="printer-status"><div class="dot"></div> Prête</div>
                </div>
                <button class="btn-test" onclick="doAction('/api/test', 'printer=${encodeURIComponent(p.name)}')">Tester Page</button>
              </div>
            </div>
          `).join('')}

          <div class="printer-card" style="margin-top: 40px; border-color: #3b82f6;">
            <p><span class="step-number">1</span> URL IPP (Port 631) :</p>
            <div class="url-box">
              http://${localIP}:631/ipp/print
            </div>
            <p style="font-size: 0.85em; color: #94a3b8;">Si vous configurez manuellement : Choisissez "Imprimante partagée par nom" et collez l'URL ci-dessus.</p>
          </div>
        </div>
      </body>
    </html>
  `);
});

app.use(express.urlencoded({ extended: true }));
app.post('/api/test', async (req, res) => {
  const { printer } = req.body;
  await triggerTestPage(printer);
  res.json({ success: true });
});

app.listen(DASHBOARD_PORT, '0.0.0.0', () => {
  const localIP = Object.values(os.networkInterfaces())
    .flat()
    .find(i => i?.family === 'IPv4' && !i.internal)?.address || 'localhost';
  console.log(`\x1b[32m[SYSTEM] Dashboard V1.8.9 : http://${localIP}:${DASHBOARD_PORT}\x1b[0m`);
});

// --- SERVEUR IPP ---
function createIppServer() {
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/ipp/print') {
      const chunks: any[] = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', async () => {
        const body = Buffer.concat(chunks);
        console.log(`\x1b[33m[IPP] Job reçu (${body.length} octets)\x1b[0m`);
        
        let printerName = '';
        try {
          const bodyStr = body.toString('binary');
          const printerMatch = bodyStr.match(/ipp:\/\/.*?\/ipp\/print/);
          if (printerMatch) printerName = printerMatch[0];
        } catch(e) {}

        await sendToPhysicalPrinter(body, printerName);

        const header = body.slice(0, 8);
        header[2] = 0x00; header[3] = 0x00; // Success

        const resBody = Buffer.concat([
          header,
          Buffer.from([0x01, 0x47, 0x00, 0x12, 0x61, 0x74, 0x74, 0x72, 0x69, 0x62, 0x75, 0x74, 0x65, 0x73, 0x2d, 0x63, 0x68, 0x61, 0x72, 0x73, 0x65, 0x74, 0x00, 0x05, 0x75, 0x74, 0x66, 0x2d, 0x38, 0x48, 0x00, 0x1b, 0x61, 0x74, 0x74, 0x72, 0x69, 0x62, 0x75, 0x74, 0x65, 0x73, 0x2d, 0x6e, 0x61, 0x74, 0x75, 0x72, 0x61, 0x6c, 0x2d, 0x6c, 0x61, 0x6e, 0x67, 0x75, 0x61, 0x67, 0x65, 0x00, 0x05, 0x65, 0x6e, 0x2d, 0x75, 0x73, 0x03])
        ]);
        res.writeHead(200, { 'Content-Type': 'application/ipp' });
        res.end(resBody);
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  return server;
}

// --- SYNCHRONISATION ---
socket.on('connect', () => {
  console.log(`\x1b[32m[SOCKET] Pont Actif (ID: ${AGENT_ID})\x1b[0m`);
  updatePrinterList();
});

socket.on('print_job', async (data: any) => {
  if (data.fileData) {
    const buffer = Buffer.from(data.fileData, 'base64');
    await sendToPhysicalPrinter(buffer, data.printerName);
  }
});

socket.on('print_test_page', async ({ printerName }) => {
  triggerTestPage(printerName);
});

async function updatePrinterList() {
  try {
    const script = `chcp 65001 >$null; Get-Printer | Select-Object Name | ConvertTo-Json`;
    const { stdout } = await execAsync(`PowerShell -Command "${script}"`);
    if (stdout) {
      const data = JSON.parse(stdout);
      const printers = Array.isArray(data) ? data : [data];
      const filtered = printers.filter(p => !/pdf|onenote|fax|microsoft|xps|root|writer|generic|via|bridge/i.test(p.Name));
      localPrinters = filtered.map(p => ({ name: p.Name, status: 'online' }));
    }
    socket.emit('update_printers', localPrinters);
  } catch (err) {}
}

setInterval(updatePrinterList, 60000);

const server = createIppServer();
server.listen(IPP_PORT, '0.0.0.0', async () => {
  const localIP = Object.values(os.networkInterfaces()).flat().find(i => i?.family === 'IPv4' && !i.internal)?.address || 'localhost';
  console.log(`\x1b[32m[NETWORK] Agent V1.8.9 prêt sur http://${localIP}:${IPP_PORT}/ipp/print\x1b[0m`);
  try {
    await execAsync(`PowerShell -Command "New-NetFirewallRule -DisplayName 'VIA IPP 631' -Direction Inbound -LocalPort 631 -Protocol TCP -Action Allow -ErrorAction SilentlyContinue"`);
  } catch(e) {}
});

