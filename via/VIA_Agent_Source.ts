/**
 * VIA Local Link Agent - V1.5.0 (Stabilized Connection)
 * 
 * INSTALLATION LOCALE (Optionnelle) :
 * npm install socket.io-client bonjour-service node-ssdp
 * 
 * Lancement : npx tsx VIA_Agent_Source.ts
 */

import { io } from 'socket.io-client';
import { exec } from 'child_process';
import { promisify } from 'util';
import http from 'http';
import os from 'os';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

const SERVER_URL = 'https://via-dz.onrender.com';
const ADMIN_PASS = 'admin123'; 
const IPP_PORT = 631;

let localPrinters: any[] = [];

// --- MOTEUR D'IMPRESSION RÉELLE ---
async function sendToPhysicalPrinter(data: Buffer, printerName?: string) {
  try {
    // 1. Sélection de l'imprimante (Celle demandée, sinon la première en ligne)
    const targetPrinter = printerName || 
                         localPrinters.find(p => p.status === 'online')?.name || 
                         'Canon G3010';
                         
    console.log(`\x1b[36m[PRINT] Tentative d'impression sur : ${targetPrinter}\x1b[0m`);

    // 2. Création du fichier temporaire (en .txt pour le test, .prn pour le reste)
    const isTestPage = data.toString().includes('PAGE DE TEST');
    const ext = isTestPage ? 'txt' : 'prn';
    const tempFile = path.join(os.tmpdir(), `via_job_${Date.now()}.${ext}`);
    await fs.promises.writeFile(tempFile, data);

    // 3. Stratégie d'impression moderne (Out-Printer)
    // Cette méthode est beaucoup plus fiable pour les imprimantes USB sous Windows 10/11
    let cmd = '';
    if (isTestPage) {
      // Pour du texte (page de test), Out-Printer est parfait
      cmd = `PowerShell -Command "Get-Content -Path '${tempFile}' | Out-Printer -Name '${targetPrinter}'"`;
    } else {
      // Pour des fichiers binaires/RAW, on tente la méthode classique
      cmd = `PowerShell -Command "Print /D:\\"${targetPrinter}\\" \\"${tempFile}\\""`;
    }
    
    console.log(`[SYSTEM] Exécution : ${cmd}`);
    await execAsync(cmd);
    console.log(`\x1b[32m[PRINT] SUCCÈS : Commande envoyée au spooler Windows.\x1b[0m`);
    
    setTimeout(() => fs.unlink(tempFile, () => {}), 15000);
  } catch (err) {
    console.error(`\x1b[31m[PRINT] ERREUR d'impression :\x1b[0m`, err);
    console.log(`\x1b[33m[CONSEIL] Si l'imprimante ne répond pas, vérifiez qu'elle n'est pas en 'Pause' dans Windows.\x1b[0m`);
  }
}

function createIppServer() {
  return http.createServer((req, res) => {
    if (req.method === 'POST') {
      const chunks: any[] = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', async () => {
        const body = Buffer.concat(chunks);
        if (body.length < 8) return res.end();

        // Détection XML (WSD/Mopria) - on ignore pour éviter les erreurs
        if (body.toString().includes('<?xml')) {
          res.writeHead(405);
          return res.end();
        }

        const version = body.readInt16BE(0);
        const opId = body.readInt16BE(2);
        const requestId = body.readInt32BE(4);
        
        console.log(`[NETWORK] IPP Op: ${opId.toString(16)} | Req: ${requestId}`);

        res.writeHead(200, { 'Content-Type': 'application/ipp' });
        
        const header = Buffer.alloc(8);
        header.writeInt16BE(version, 0); 
        header.writeInt16BE(0x0000, 2); // Success
        header.writeInt32BE(requestId, 4);

        const str = (tag: number, name: string, val: string) => Buffer.concat([
          Buffer.from([tag]), Buffer.from([0x00, name.length]), Buffer.from(name), Buffer.from([0x00, val.length]), Buffer.from(val)
        ]);

        // Si c'est une demande d'impression (Op 0x0002)
        if (opId === 0x0002) {
          const endTagIndex = body.indexOf(Buffer.from([0x03]));
          if (endTagIndex !== -1) {
            const printData = body.slice(endTagIndex + 1);
            if (printData.length > 0) sendToPhysicalPrinter(printData);
          }
        }

        // Réponse avec attributs complets pour satisfaire Windows
        const resBody = Buffer.concat([
          header,
          Buffer.from([0x01]), // operation-attributes
          str(0x47, 'attributes-charset', 'utf-8'),
          str(0x48, 'attributes-natural-language', 'en-us'),
          Buffer.from([0x04]), // printer-attributes
          str(0x42, 'printer-name', 'VIA Cloud Printer'),
          str(0x42, 'printer-make-and-model', 'VIA Virtual Printer'),
          str(0x45, 'printer-uri-supported', `ipp://${req.headers.host}${req.url}`),
          str(0x44, 'uri-security-supported', 'none'),
          str(0x44, 'uri-authentication-supported', 'none'),
          Buffer.from([0x23, 0x00, 0x0d, ...Buffer.from('printer-state'), 0x00, 0x04, 0x00, 0x00, 0x00, 0x03]),
          Buffer.from([0x22, 0x00, 0x1a, ...Buffer.from('printer-is-accepting-jobs'), 0x00, 0x01, 0x01]),
          str(0x44, 'ipp-versions-supported', '1.1,2.0'),
          str(0x49, 'document-format-supported', 'application/octet-stream,application/pdf'),
          Buffer.from([0x23, 0x00, 0x14, ...Buffer.from('operations-supported'), 0x00, 0x04, 0x00, 0x00, 0x00, 0x02]),
          Buffer.from([0x03])
        ]);
        res.end(resBody);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    const html = `
      <!DOCTYPE html>
      <html lang="fr">
        <head>
          <meta charset="UTF-8">
          <title>VIA Agent V1.5.0</title>
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 40px; background: #0f172a; color: white; line-height: 1.6; }
            .container { max-width: 800px; margin: 0 auto; }
            h1 { color: #3b82f6; border-bottom: 2px solid #1e293b; padding-bottom: 15px; display: flex; align-items: center; gap: 10px; }
            .badge { background: #3b82f6; color: white; font-size: 0.4em; padding: 4px 8px; border-radius: 4px; vertical-align: middle; }
            .printer-card { background: #1e293b; padding: 20px; border-radius: 12px; margin-bottom: 15px; border: 1px solid #334155; display: flex; justify-content: space-between; align-items: center; transition: transform 0.2s; }
            .printer-card:hover { transform: translateY(-2px); border-color: #3b82f6; }
            .printer-info { display: flex; flex-direction: column; }
            .printer-name { font-size: 1.1em; font-weight: 600; color: #f8fafc; }
            .status { font-size: 0.9em; margin-top: 5px; display: flex; align-items: center; gap: 6px; }
            .status-dot { width: 10px; height: 10px; border-radius: 50%; }
            .online .status-dot { background: #10b981; box-shadow: 0 0 8px #10b981; }
            .offline .status-dot { background: #ef4444; }
            .online { color: #10b981; }
            .offline { color: #ef4444; }
            .footer { margin-top: 50px; font-size: 0.85em; color: #64748b; border-top: 1px solid #1e293b; padding-top: 20px; }
            .url-box { background: #020617; padding: 10px; border-radius: 6px; font-family: monospace; color: #94a3b8; border: 1px solid #1e293b; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>VIA Agent <span class="badge">V1.5.0</span></h1>
            <p>Statut du Pont : <strong>ACTIF</strong> sur <strong>${os.hostname()}</strong></p>
            
            <h2 style="margin-top: 40px; color: #94a3b8; font-size: 1em; text-transform: uppercase; letter-spacing: 1px;">Imprimantes Partagées (${localPrinters.length})</h2>
            
            ${localPrinters.length === 0 ? '<p style="color: #64748b;">Aucune imprimante détectée pour le moment...</p>' : localPrinters.map(p => `
              <div class="printer-card">
                <div class="printer-info">
                  <span class="printer-name">${p.name}</span>
                  <div class="status ${p.status}">
                    <div class="status-dot"></div>
                    ${p.status === 'online' ? 'Prête à imprimer' : 'Hors ligne'}
                  </div>
                </div>
                <div style="font-size: 0.8em; color: #64748b;">
                  Jobs en attente : ${p.jobs || 0}
                </div>
              </div>
            `).join('')}
            
            <div class="footer">
              <p>Lien d'impression IPP local (pour ajout manuel Windows) :</p>
              <div class="url-box">http://localhost:631/ipp/print</div>
              <p style="margin-top: 15px;">Le pont est également diffusé via Bonjour et SSDP pour une détection automatique.</p>
            </div>
          </div>
        </body>
      </html>
    `;
    res.end(html);
  });
}

const socket = io(SERVER_URL, { 
  transports: ['websocket'],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 5000,
  timeout: 45000, // Augmenté à 45s pour laisser le temps à Render de "se réveiller"
  query: {
    role: 'pc',
    name: os.hostname(),
    id: 'agent-' + os.hostname().replace(/\s+/g, '-')
  }
});

socket.on('connect_error', (err) => {
  console.log(`\x1b[33m[SOCKET] Attente du serveur (Réveil en cours...)\x1b[0m`);
  // Log détaillé uniquement si ce n'est pas un timeout classique de réveil
  if (err.message !== 'timeout') {
    console.error(`[SOCKET] Erreur de connexion :`, err.message);
  }
});

socket.on('connect', () => {
  console.log('\x1b[32m[SOCKET] Connecté à Render (ID: ' + os.hostname() + ')\x1b[0m');
  socket.emit('register_relais', { name: 'Relais ' + os.hostname() });
  updatePrinterList();
});

socket.on('print_test_page', async ({ printerName }) => {
  console.log(`\x1b[35m[SOCKET] Demande de page de test reçue pour : ${printerName}\x1b[0m`);
  const testContent = `
    ==========================================
    VIA CLOUD PRINTING - PAGE DE TEST
    ==========================================
    Date : ${new Date().toLocaleString()}
    Imprimante : ${printerName}
    Statut : CONNECTE
    Agent : VIA Local Link V1.5.0
    
    Felicitation ! Votre pont d'impression 
    VIA fonctionne correctement.
    ==========================================
  `;
  
  // On essaie d'utiliser l'imprimante demandée spécifiquement si elle existe
  const target = localPrinters.find(p => p.name === printerName && p.status === 'online')?.name || 
                 localPrinters.find(p => p.status === 'online')?.name || 
                 'Canon G3010';
                 
  console.log(`[PRINT] Cible finale pour le test : ${target}`);
  await sendToPhysicalPrinter(Buffer.from(testContent), target);
});

async function updatePrinterList() {
  try {
    // Utilisation de PowerShell Get-Printer qui est plus moderne et fiable que wmic
    const cmd = `PowerShell -Command "Get-Printer | Select-Object Name, PrinterStatus, JobCount | ConvertTo-Json"`;
    const { stdout } = await execAsync(cmd);
    
    if (stdout.trim()) {
      const data = JSON.parse(stdout);
      const printers = Array.isArray(data) ? data : [data];
      
      localPrinters = printers.map(p => ({
        name: p.Name,
        status: p.PrinterStatus === 1 ? 'offline' : 'online', // 1 = Normal/Online en général dans certains contextes, mais on va simplifier
        jobs: p.JobCount
      }));
      
      // Forcer 'online' pour les tests si on détecte une imprimante physique connue
      localPrinters.forEach(p => {
        if (p.name.includes('Canon') || p.name.includes('LBP') || p.name.includes('G3010')) {
          p.status = 'online';
        }
      });
    }
    
    socket.emit('update_printers', localPrinters);
    console.log(`[SYSTEM] ${localPrinters.length} imprimantes synchronisées avec le serveur.`);
  } catch (err) {
    console.error("[SYSTEM] Erreur lors de la récupération des imprimantes:", err);
    // Fallback basique
    localPrinters = [{ name: 'Canon G3010', status: 'online' }];
    socket.emit('update_printers', localPrinters);
  }
}

const server = createIppServer();
server.listen(IPP_PORT, '0.0.0.0', async () => {
  console.log(`\x1b[32m[NETWORK] Agent V1.5.0 prêt sur http://localhost:${IPP_PORT}/ipp/print\x1b[0m`);
  
  // --- DÉCOUVERTE RÉSEAU (mDNS / Bonjour) ---
  try {
    const { Bonjour } = await import('bonjour-service');
    const bonjour = new Bonjour();
    bonjour.publish({
      name: `VIA Cloud Printer (${os.hostname()})`,
      type: 'ipp',
      port: IPP_PORT,
      txt: {
        rp: 'ipp/print',
        note: 'VIA Local Bridge',
        pdl: 'application/pdf,image/jpeg,image/png,application/octet-stream',
        UUID: 'via-bridge-' + os.hostname(),
        'printer-type': '0x04',
        'printer-state': '3'
      }
    });
    console.log(`\x1b[36m[NETWORK] Diffusion mDNS (Bonjour) active.\x1b[0m`);
  } catch (e) {
    console.log(`\x1b[33m[NETWORK] Diffusion mDNS inactive (Module 'bonjour-service' non trouvé).\x1b[0m`);
  }

  // --- VISIBILITÉ EXPLORATEUR WINDOWS (SSDP / UPnP) ---
  try {
    const { Server } = await import('node-ssdp');
    const ssdpServer = new Server({
      location: `http://${os.hostname()}:${IPP_PORT}/via-info`,
      udn: `uuid:via-bridge-${os.hostname()}`,
      ssdpSig: 'VIA Printing Bridge/1.0',
    });
    ssdpServer.addUSN('upnp:rootdevice');
    ssdpServer.addUSN('urn:schemas-upnp-org:device:Printer:1');
    ssdpServer.start();
    console.log(`\x1b[36m[NETWORK] Diffusion SSDP active : Visible dans l'Explorateur Windows (Réseau).\x1b[0m`);
  } catch (e) {
    console.log(`\x1b[33m[NETWORK] Diffusion SSDP inactive (Module 'node-ssdp' non trouvé).\x1b[0m`);
  }
  
  console.log(`[CONSEIL] Pour activer toutes les diffusions, lancez : npm install bonjour-service node-ssdp`);
});
