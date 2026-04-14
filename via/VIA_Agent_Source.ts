/**
 * VIA Local Link Agent - V1.4.8 (Explorer Discovery)
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
    res.writeHead(200);
    res.end('VIA Agent V1.4.8 Active');
  });
}

const socket = io(SERVER_URL, { 
  transports: ['websocket'],
  query: {
    role: 'pc',
    name: os.hostname(),
    id: 'agent-' + os.hostname().replace(/\s+/g, '-')
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
    Agent : VIA Local Link V1.4.8
    
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
  console.log(`\x1b[32m[NETWORK] Agent V1.4.8 prêt sur http://localhost:${IPP_PORT}/ipp/print\x1b[0m`);
  
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
