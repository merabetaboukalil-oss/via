/**
 * VIA Local Link Agent - V1.4.3 (Strict Printer Targeting)
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
const IPP_PORT = 631;

let localPrinters: any[] = [];

// --- MOTEUR D'IMPRESSION RÉELLE ---
async function sendToPhysicalPrinter(data: Buffer, printerName?: string) {
  try {
    // 1. Sélection de l'imprimante (Celle demandée, sinon la première en ligne)
    const targetPrinter = printerName || 
                         localPrinters.find(p => p.status === 'online')?.name || 
                         'Canon G3010';
                         
    console.log(`\x1b[36m[PRINT] Préparation de l'envoi vers : ${targetPrinter}\x1b[0m`);

    // 2. Création du fichier temporaire
    const tempFile = path.join(os.tmpdir(), `via_job_${Date.now()}.prn`);
    await fs.promises.writeFile(tempFile, data);

    // 3. Envoi direct au spooler Windows
    // Utilisation de guillemets doubles échappés pour gérer les noms complexes (slashs, espaces)
    const cmd = `PowerShell -Command "Print /D:\\"${targetPrinter}\\" \\"${tempFile}\\""`;
    
    await execAsync(cmd);
    console.log(`\x1b[32m[PRINT] SUCCÈS : Document envoyé à l'imprimante physique.\x1b[0m`);
    
    setTimeout(() => fs.unlink(tempFile, () => {}), 10000);
  } catch (err) {
    console.error(`\x1b[31m[PRINT] ERREUR d'impression :\x1b[0m`, err);
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
        if (body.toString().includes('<?xml')) { res.writeHead(405); return res.end(); }

        const version = body.readInt16BE(0);
        const opId = body.readInt16BE(2);
        const requestId = body.readInt32BE(4);
        
        console.log(`[NETWORK] IPP Op: ${opId.toString(16)} | Req: ${requestId}`);

        res.writeHead(200, { 'Content-Type': 'application/ipp' });
        const header = Buffer.alloc(8);
        header.writeInt16BE(version, 0); 
        header.writeInt16BE(0x0000, 2); 
        header.writeInt32BE(requestId, 4);

        if (opId === 0x0002) {
          const endTagIndex = body.indexOf(Buffer.from([0x03]));
          if (endTagIndex !== -1) {
            const printData = body.slice(endTagIndex + 1);
            if (printData.length > 0) sendToPhysicalPrinter(printData);
          }
        }

        const str = (tag: number, name: string, val: string) => Buffer.concat([
          Buffer.from([tag]), Buffer.from([0x00, name.length]), Buffer.from(name), Buffer.from([0x00, val.length]), Buffer.from(val)
        ]);

        const resBody = Buffer.concat([
          header, Buffer.from([0x01]),
          str(0x47, 'attributes-charset', 'utf-8'),
          str(0x48, 'attributes-natural-language', 'en-us'),
          Buffer.from([0x04]),
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
    res.end('VIA Agent V1.4.3 Active');
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
    Agent : VIA Local Link V1.4.3
    
    Felicitation ! Votre pont d'impression 
    VIA fonctionne correctement.
    ==========================================
  `;
  
  const target = localPrinters.find(p => p.name === printerName && p.status === 'online')?.name || 
                 localPrinters.find(p => p.status === 'online')?.name || 
                 'Canon G3010';
                 
  console.log(`[PRINT] Cible finale pour le test : ${target}`);
  await sendToPhysicalPrinter(Buffer.from(testContent), target);
});

async function updatePrinterList() {
  try {
    const { stdout } = await execAsync('wmic printer get name, workoffline /format:list');
    localPrinters = stdout.split('\r\r\n\r\r\n').filter(b => b.trim()).map(block => ({
      name: block.split('\r\r\n').find(l => l.startsWith('Name='))?.split('=')[1] || 'Unknown',
      status: block.includes('WorkOffline=TRUE') ? 'offline' : 'online'
    }));
    socket.emit('update_printers', localPrinters);
  } catch (err) {
    localPrinters = [{ name: 'Canon G3010', status: 'online' }];
  }
}

const server = createIppServer();
server.listen(IPP_PORT, '0.0.0.0', () => {
  console.log(`\x1b[32m[NETWORK] Agent V1.4.3 prêt sur http://localhost:${IPP_PORT}/ipp/print\x1b[0m`);
});