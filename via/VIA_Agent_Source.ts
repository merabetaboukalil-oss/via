/**
 * VIA Local Link Agent - V1.7.1 (Force Print Edition)
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

// --- UTILITAIRES RÉSEAU ---
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return os.hostname();
}

// --- FONCTION POUR OUVRIR LE PARE-FEU ---
async function fixWindowsFirewall() {
  try {
    console.log("\x1b[33m[SYSTEM] Tentative d'ouverture du port 631 dans le Pare-feu...\x1b[0m");
    // Version de production silencieuse (sans -NoExit) car la configuration est validée
    const cmd = `PowerShell -Command "Start-Process PowerShell -Verb RunAs -ArgumentList 'New-NetFirewallRule -DisplayName VIA_Printer_Bridge -Direction Inbound -LocalPort 631 -Protocol TCP -Action Allow -ErrorAction SilentlyContinue'"`;
    await execAsync(cmd);
    return true;
  } catch (e) {
    console.error("[SYSTEM] Erreur Pare-feu:", e);
    return false;
  }
}

// --- LOGIQUE DE TEST PAGE ---
async function triggerTestPage(printerName: string) {
  const testContent = `
    ==========================================
    VIA CLOUD PRINTING - PAGE DE TEST
    ==========================================
    Date : ${new Date().toLocaleString()}
    Imprimante : ${printerName}
    Statut : CONNECTE
    Agent : VIA Local Link V1.7.1
    
    Felicitation ! Votre pont d'impression 
    VIA fonctionne correctement.
    ==========================================
  `;
  
  const target = localPrinters.find(p => p.name === printerName && p.status === 'online')?.name || 
                 localPrinters.find(p => p.status === 'online')?.name || 
                 'Canon G3010';
                 
  console.log(`[LOCAL-DASH] Déclenchement page de test pour : ${target}`);
  await sendToPhysicalPrinter(Buffer.from(testContent), target);
}

// --- MOTEUR D'IMPRESSION RÉELLE ---
async function sendToPhysicalPrinter(data: Buffer, printerName?: string) {
  try {
    // 1. Sélection intelligente de l'imprimante
    // On exclut les imprimantes de type "VIA" ou "Bridge" pour éviter de boucler sur soi-même
    const physicalPrinters = localPrinters.filter(p => 
      !p.name.toLowerCase().includes('via') && 
      !p.name.toLowerCase().includes('bridge') &&
      !p.name.toLowerCase().includes('pdf') &&
      !p.name.toLowerCase().includes('onenote') &&
      !p.name.toLowerCase().includes('fax')
    );

    const targetPrinter = printerName || 
                         physicalPrinters.find(p => /Canon|LBP|HP|LaserJet|InkJet|Epson|Brother|Samsung|Xerox|Lexmark/i.test(p.name))?.name ||
                         physicalPrinters[0]?.name ||
                         'Printer';
                         
    console.log(`\x1b[36m[PRINT] Route d'impression physique vers -> ${targetPrinter}\x1b[0m`);

    // 2. Création du fichier temporaire
    // On utilise un format binaire (.raw) pour les flux IPP
    const isTestPage = data.toString().includes('PAGE DE TEST');
    const ext = isTestPage ? 'txt' : 'raw';
    const tempFile = path.join(os.tmpdir(), `via_job_${Date.now()}.${ext}`);
    await fs.promises.writeFile(tempFile, data);

    // 3. Impression via PowerShell (Out-Printer)
    // Out-Printer est beaucoup plus robuste que la commande 'Print /D:' pour les imprimantes USB modernes
    // et gère nativement les flux binaires si on ne passe pas par Get-Content
    let cmd = '';
    if (isTestPage) {
      cmd = `PowerShell -Command "Get-Content -Path '${tempFile}' | Out-Printer -Name '${targetPrinter}'"`;
    } else {
      // Pour les travaux IPP (RAW), on utilise une astuce PowerShell pour envoyer le binaire
      cmd = `PowerShell -Command "Add-Type -AssemblyName System.Drawing; [System.IO.File]::ReadAllBytes('${tempFile}') | Out-Printer -Name '${targetPrinter}'"`;
      
      // Si Out-Printer échoue sur du binaire pur, on peut aussi tenter Copy /B pour les ports USB mapped (mais restons sur le plus universel)
      // On va simplifier pour essayer de garantir la sortie
      cmd = `PowerShell -Command "Start-Process -FilePath 'print.exe' -ArgumentList '/D:\\"${targetPrinter}\\"', '\\"${tempFile}\\"' -WindowStyle Hidden"`;
    }
    
    // Correction finale : Utilisons une méthode universelle pour tout type de données
    // La commande 'Print' de Windows est parfois capricieuse sur les ports USB.
    // Tentons une approche plus directe pour les fichiers RAW sur USB.
    if (!isTestPage) {
       // On privilégie Out-Printer avec un flux de lecture brut
       cmd = `PowerShell -Command "Get-Content -Path '${tempFile}' -Encoding Byte -Raw | Out-Printer -Name '${targetPrinter}'"`;
       // Note : Sous PowerShell 5.1 (standard), -Encoding Byte est requis. Sous PS 7+, c'est -AsByteStream.
       // Pour être sûr, on utilise une version compatible :
       cmd = `PowerShell -Command "Set-Content -Path '${tempFile}.tmp' -Value (Get-Content '${tempFile}' -Encoding Byte) ; Out-Printer -InputObject (Get-Content '${tempFile}.tmp') -Name '${targetPrinter}'"`;
       
       // Plus simple et plus fiable :
       cmd = `PowerShell -Command "Get-Content '${tempFile}' -Raw | Out-Printer -Name '${targetPrinter}'"`;
    }

    console.log(`[SYSTEM] Commande : ${cmd}`);
    await execAsync(cmd);
    console.log(`\x1b[32m[PRINT] SUCCÈS : Transmis à l'imprimante physique.\x1b[0m`);
    
    setTimeout(() => fs.unlink(tempFile, () => {}), 15000);
  } catch (err) {
    console.error(`\x1b[31m[PRINT] ERREUR :\x1b[0m`, err);
  }
}

function createIppServer() {
  return http.createServer((req, res) => {
    const baseURL = `http://${req.headers.host || 'localhost'}`;
    const reqURL = new URL(req.url || '', baseURL);
    
    // 1. ROUTE INTERFACE DASHBOARD (Uniquement sur /)
    if (req.method === 'GET' && reqURL.pathname === '/') {
      const localIP = getLocalIP();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <!DOCTYPE html>
        <html lang="fr">
          <head>
            <meta charset="UTF-8">
            <title>VIA Agent V1.6.7</title>
            <style>
              body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 40px; background: #0f172a; color: white; line-height: 1.6; }
              .container { max-width: 800px; margin: 0 auto; }
              h1 { color: #3b82f6; border-bottom: 2px solid #1e293b; padding-bottom: 15px; display: flex; align-items: center; gap: 10px; }
              .badge { background: #3b82f6; color: white; font-size: 0.4em; padding: 4px 8px; border-radius: 4px; vertical-align: middle; }
              .printer-card { background: #1e293b; padding: 25px; border-radius: 12px; margin-bottom: 15px; border: 1px solid #334155; }
              .printer-info-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
              .printer-name { font-size: 1.2em; font-weight: 600; color: #f8fafc; }
              .status { font-size: 0.9em; margin-top: 5px; display: flex; align-items: center; gap: 6px; }
              .status-dot { width: 10px; height: 10px; border-radius: 50%; }
              .online .status-dot { background: #10b981; box-shadow: 0 0 8px #10b981; }
              .offline .status-dot { background: #ef4444; }
              .actions { display: flex; gap: 10px; }
              button { cursor: pointer; padding: 8px 16px; border-radius: 6px; border: none; font-size: 0.85em; font-weight: 600; transition: all 0.2s; }
              .btn-test { background: #334155; color: white; border: 1px solid #475569; }
              .btn-test:hover { background: #475569; }
              .success-step { background: rgba(16, 185, 129, 0.1); border: 1px solid #10b981; padding: 25px; border-radius: 12px; margin-top: 40px; }
              .step-number { background: #10b981; color: white; width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; margin-right: 10px; font-size: 0.8em; font-weight: bold; }
              .btn-copy { background: #020617; color: #10b981; border: 1px solid #10b981; padding: 4px 8px; border-radius: 4px; font-size: 0.7em; margin-left: 10px; cursor: pointer; }
              .url-box { background: #020617; padding: 12px; border-radius: 8px; font-family: monospace; color: #10b981; border: 1px solid #10b981; display: block; margin: 15px 0; font-size: 1.1em; font-weight: bold; text-align: center; }
              .toast { position: fixed; bottom: 20px; right: 20px; background: #10b981; color: white; padding: 12px 24px; border-radius: 8px; display: none; }
            </style>
            <script>
              async function doAction(endpoint, params = '') {
                try {
                  const res = await fetch(endpoint + (params ? '?' + params : ''));
                  if (res.ok) { showToast("Action effectuée !"); }
                } catch (e) { alert("Erreur lors de l'action"); }
              }
              function copyUrl() {
                const url = "http://${localIP}:631/ipp/print";
                navigator.clipboard.writeText(url);
                showToast("URL Copiée !");
              }
              function showToast(msg) {
                const t = document.getElementById('toast');
                t.innerText = msg;
                t.style.display = 'block';
                setTimeout(() => t.style.display = 'none', 3000);
              }
            </script>
          </head>
          <body>
            <div class="container">
              <h1>VIA Agent <span class="badge">V1.7.1</span></h1>
              <p>Statut du Pont : <strong>ACTIF</strong> sur <strong>${os.hostname()}</strong> (${localIP})</p>
              
              <h2 style="margin-top: 40px; color: #94a3b8; font-size: 1em; text-transform: uppercase; letter-spacing: 1px;">Imprimantes Détectées</h2>
              
              ${localPrinters.length === 0 ? '<p style="color: #64748b;">Recherche d\'imprimantes en cours...</p>' : localPrinters.map(p => `
                <div class="printer-card">
                  <div class="printer-info-row">
                    <div>
                      <span class="printer-name">${p.name}</span>
                      <div class="status ${p.status}">
                        <div class="status-dot"></div>
                        ${p.status === 'online' ? 'Partagée sur VIA' : 'Hors ligne'}
                      </div>
                    </div>
                    <div class="actions">
                      <button class="btn-test" onclick="doAction('/api/test', 'printer=${encodeURIComponent(p.name)}')">Tester Physiquement</button>
                    </div>
                  </div>
                </div>
              `).join('')}
              
              <div class="success-step">
                <h3 style="color: #10b981; margin-top: 0;">🎉 Votre Réseau est Prêt !</h3>
                <p>La page s'affiche, donc rien ne bloque la connexion. Voici comment finaliser l'ajout :</p>
                
                <div style="margin-top: 20px;">
                  <p><span class="step-number">1</span> Copiez cet URL :</p>
                  <div class="url-box">
                    http://${localIP}:631/ipp/print
                    <button class="btn-copy" onclick="copyUrl()">Copier</button>
                  </div>
                  
                  <p><span class="step-number">2</span> Sur l'autre PC :</p>
                  <ul style="font-size: 0.95em; color: #cbd5e1; list-style: none; padding-left: 10px;">
                    <li>➜ <strong>Paramètres > Imprimantes et scanners > Ajouter</strong></li>
                    <li>➜ Cliquez sur <strong>"L'imprimante que je veux n'est pas répertoriée"</strong></li>
                    <li>➜ Choisissez <strong>"Sélectionner une imprimante partagée par nom"</strong></li>
                    <li>➜ Collez l'URL ci-dessus.</li>
                    <li style="color: #fb7185; margin-top: 10px; font-weight: bold; border-left: 3px solid #fb7185; padding-left: 10px;">
                      ⚠️ SI VOUS AVEZ UNE ERREUR (Paramètre incorrect) :<br>
                      1. Dans l'onglet "Avancé", <strong>DÉCOCHEZ</strong> la case :<br>
                      "Activer les fonctionnalités d'impression avancées".<br>
                      2. Choisissez le pilote <strong>Generic / Text Only</strong> (ou Microsoft Software).<br>
                      3. Cliquez sur Appliquer.
                    </li>
                  </ul>
                </div>
              </div>
            </div>
            <div id="toast" class="toast"></div>
          </body>
        </html>
      `);
      return;
    }

    // 2. ROUTES API
    if (reqURL.pathname === '/api/fix-firewall') {
      fixWindowsFirewall().then(success => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: success ? 'ok' : 'error' }));
      });
      return;
    }

    // API : Page de Test Locale
    if (reqURL.pathname === '/api/test') {
      const printer = reqURL.searchParams.get('printer');
      if (printer) {
        triggerTestPage(printer);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'ok' }));
      }
    }

    // API : Forcer la synchro Cloud
    if (reqURL.pathname === '/api/sync') {
      updatePrinterList();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'ok' }));
    }

    // 3. SERVICE IPP (Uniquement sur /ipp/print)
    if (reqURL.pathname === '/ipp/print') {
      // Windows probe par GET parfois
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end('VIA IPP Service Active');
      }

      if (req.method === 'POST') {
        const chunks: any[] = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', async () => {
          const body = Buffer.concat(chunks);
          if (body.length < 8) return res.end();

          const version = body.readInt16BE(0);
          const opId = body.readInt16BE(2);
          const requestId = body.readInt32BE(4);
          
          console.log(`[IPP] Op: 0x${opId.toString(16).padStart(4, '0')} | Req: ${requestId}`);

          res.writeHead(200, { 'Content-Type': 'application/ipp', 'X-IPP-Version': '2.0' });
          
          const header = Buffer.alloc(8);
          header.writeInt16BE(version, 0); 
          header.writeInt16BE(0x0000, 2); // Status: successful-ok
          header.writeInt32BE(requestId, 4);

          const str = (tag: number, name: string, val: string) => Buffer.concat([
            Buffer.from([tag]), Buffer.from([0x00, name.length]), Buffer.from(name), Buffer.from([0x00, val.length]), Buffer.from(val)
          ]);

          const multiStr = (tag: number, name: string, vals: string[]) => {
            let res = str(tag, name, vals[0]);
            for (let i = 1; i < vals.length; i++) {
              res = Buffer.concat([res, Buffer.from([tag, 0x00, 0x00, 0x00, vals[i].length]), Buffer.from(vals[i])]);
            }
            return res;
          };

          const multiEnum = (name: string, vals: number[]) => {
            const first = Buffer.concat([
              Buffer.from([0x23, 0x00, name.length]), Buffer.from(name), 
              Buffer.from([0x00, 0x04]), Buffer.alloc(4)
            ]);
            first.writeInt32BE(vals[0], first.length - 4);
            let res = first;
            for (let i = 1; i < vals.length; i++) {
              const valBuf = Buffer.concat([Buffer.from([0x23, 0x00, 0x00, 0x00, 0x04]), Buffer.alloc(4)]);
              valBuf.writeInt32BE(vals[i], valBuf.length - 4);
              res = Buffer.concat([res, valBuf]);
            }
            return res;
          };

          const bool = (name: string, val: boolean) => Buffer.concat([
            Buffer.from([0x22, 0x00, name.length]), Buffer.from(name), Buffer.from([0x00, 0x01, val ? 0x01 : 0x00])
          ]);

          const int = (name: string, val: number) => {
            const b = Buffer.concat([Buffer.from([0x21, 0x00, name.length]), Buffer.from(name), Buffer.from([0x00, 0x04]), Buffer.alloc(4)]);
            b.writeInt32BE(val, b.length - 4);
            return b;
          };

          const Enum = (name: string, val: number) => {
            const b = Buffer.concat([Buffer.from([0x23, 0x00, name.length]), Buffer.from(name), Buffer.from([0x00, 0x04]), Buffer.alloc(4)]);
            b.writeInt32BE(val, b.length - 4);
            return b;
          };

          if (opId === 0x0002) { // Print-Job
            const endTagIndex = body.indexOf(Buffer.from([0x03]));
            if (endTagIndex !== -1) {
              const printData = body.slice(endTagIndex + 1);
              if (printData.length > 0) sendToPhysicalPrinter(printData);
            }
          }

              // Réponse IPP Professionnelle V1.7.0 (Universal Mode)
              const resBody = Buffer.concat([
                header,
                Buffer.from([0x01]), // operation-attributes-tag
                str(0x47, 'attributes-charset', 'utf-8'),
                str(0x48, 'attributes-natural-language', 'en-us'),
                Buffer.from([0x04]), // printer-attributes-tag
                str(0x42, 'printer-name', 'VIA-Universal-Printer'),
                str(0x42, 'printer-info', 'VIA Network Bridge'),
                str(0x42, 'printer-make-and-model', 'Generic / Text Only'),
                str(0x47, 'charset-configured', 'utf-8'),
                str(0x48, 'natural-language-configured', 'en-us'),
                str(0x45, 'printer-uri-supported', baseURL + '/ipp/print'),
                str(0x44, 'uri-security-supported', 'none'),
                str(0x44, 'uri-authentication-supported', 'none'),
                multiStr(0x44, 'ipp-versions-supported', ['1.1']),
                multiStr(0x49, 'document-format-supported', ['application/octet-stream', 'application/pdf', 'text/plain']),
                str(0x45, 'printer-uuid', 'uuid:via-universal-' + os.hostname()),
                Enum('printer-state', 3), 
                bool('printer-is-accepting-jobs', true),
                bool('color-supported', false),
                multiStr(0x44, 'sides-supported', ['one-sided']),
                multiStr(0x44, 'media-supported', ['iso_a4_210x297mm']),
                multiEnum('operations-supported', [0x0002, 0x0004, 0x000b]),
                multiStr(0x44, 'printer-state-reasons', ['none']),
                int('queued-job-count', 0),
                Buffer.from([0x03]) // end-of-attributes-tag
              ]);
              res.end(resBody);
        });
        return;
      }
    }
    // fallback
    res.writeHead(404); res.end();
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
    Agent : VIA Local Link V1.7.1
    
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
      
      // Marquage des imprimantes physiques probables
      localPrinters.forEach(p => {
        const name = p.name.toLowerCase();
        const isVirtual = name.includes('pdf') || name.includes('onenote') || name.includes('fax') || name.includes('microsoft') || name.includes('via');
        if (!isVirtual) {
          p.status = 'online'; // On considère le matos physique comme prêt
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
  console.log(`\x1b[32m[NETWORK] Agent V1.7.1 prêt sur http://localhost:${IPP_PORT}/ipp/print\x1b[0m`);
  
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
