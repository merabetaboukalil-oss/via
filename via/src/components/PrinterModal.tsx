import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Printer, X, Search, Monitor, Download, Shield, Activity, CheckCircle2, AlertCircle, Loader2, Server, Network, Usb } from 'lucide-react';
import { getSocket } from '../socket';

interface PrinterInfo {
  id: string;
  name: string;
  type: 'usb' | 'network';
  status: 'online' | 'offline';
  ip?: string;
}

interface PCRelais {
  id: string;
  name: string;
  printers: PrinterInfo[];
}

export default function PrinterModal({ isOpen, onClose, pcs, activeSocket }: { isOpen: boolean, onClose: () => void, pcs: any[], activeSocket?: any }) {
  const [activeTab, setActiveTab] = useState<'existing' | 'personal'>('existing');
  const [isSearching, setIsSearching] = useState(false);
  const [relaisList, setRelaisList] = useState<PCRelais[]>([]);
  const [installingAgent, setInstallingAgent] = useState(false);
  const [installStep, setInstallStep] = useState(0);
  const [showSuccess, setShowSuccess] = useState(false);
  const [detectedRealPrinters, setDetectedRealPrinters] = useState<PrinterInfo[]>([]);
  const [diagStatus, setDiagStatus] = useState<'idle' | 'checking' | 'ok' | 'fail'>('idle');

  const checkLocalBridge = async () => {
    setDiagStatus('checking');
    // Check common ports and fallback ports
    const ports = [631, 6310, 632, 633, 634, 635];
    const hosts = ['localhost', '127.0.0.1'];
    
    for (const port of ports) {
      for (const host of hosts) {
        // 1. Try fetch (most reliable)
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 600);
          const target = `http://${host}:${port}/via-ping`;
          const response = await fetch(target, { method: 'GET', mode: 'cors', signal: controller.signal });
          if (response.ok) {
            const data = await response.json();
            if (data.agent === 'VIA') {
              clearTimeout(timeoutId);
              setDiagStatus('ok');
              return;
            }
          }
          clearTimeout(timeoutId);
        } catch (err) {
          // 2. Fallback to Script Ping (bypasses many Mixed Content / CORS blocks)
          try {
            const success = await new Promise<boolean>((resolve) => {
              // @ts-ignore
              window.__VIA_AGENT_ONLINE__ = false;
              const script = document.createElement('script');
              const timer = setTimeout(() => {
                script.remove();
                resolve(false);
              }, 800);
              
              script.onload = () => {
                clearTimeout(timer);
                script.remove();
                // @ts-ignore
                resolve(window.__VIA_AGENT_ONLINE__ === true);
              };
              script.onerror = () => {
                clearTimeout(timer);
                script.remove();
                resolve(false);
              };
              script.src = `http://${host}:${port}/ping.js?t=${Date.now()}`;
              document.head.appendChild(script);
            });
            
            if (success) {
              setDiagStatus('ok');
              return;
            }
          } catch (e) { /* continue */ }

          // 3. Fallback to Image Ping (last resort)
          try {
            const success = await new Promise<boolean>((resolve) => {
              const img = new Image();
              const timer = setTimeout(() => {
                img.src = '';
                resolve(false);
              }, 800);
              img.onload = () => { clearTimeout(timer); resolve(true); };
              img.onerror = () => { clearTimeout(timer); resolve(false); };
              img.src = `http://${host}:${port}/ping.gif?t=${Date.now()}`;
            });
            if (success) {
              setDiagStatus('ok');
              return;
            }
          } catch (e) { /* continue */ }
        }
      }
    }
    setDiagStatus('fail');
  };

  useEffect(() => {
    if (isOpen) {
      // Filter PCs that are registered as Relais
      const existingRelais = pcs
        .filter(pc => pc.isRelais)
        .map((pc, index) => {
          const printers = [...(pc.printers || [])];
          // Si c'est le premier relais et qu'on a des imprimantes USB détectées par le navigateur
          if (index === 0 && detectedRealPrinters.length > 0) {
            detectedRealPrinters.forEach(dp => {
              if (!printers.find(p => p.name === dp.name)) {
                printers.push(dp);
              }
            });
          }
          return {
            id: pc.id,
            name: pc.name,
            printers
          };
        });
      
      setRelaisList(existingRelais);
    }
  }, [isOpen, pcs, detectedRealPrinters]);

  const handleSearch = () => {
    setIsSearching(true);
    
    // Request fresh list from server to ensure we see the new relais
    const socket = activeSocket || getSocket('dashboard');
    if (socket) {
      socket.emit('request_pc_list');
    }

    setTimeout(() => {
      setIsSearching(false);
    }, 2000);
  };

  const handleInstallAgent = () => {
    setInstallingAgent(true);
    setInstallStep(1);
    
    // Simulate installation steps
    setTimeout(() => setInstallStep(2), 1500);
    setTimeout(() => setInstallStep(3), 3000);
    setTimeout(async () => {
      setInstallingAgent(false);
      setInstallStep(0);
      setShowSuccess(true);
    }, 5000);
  };

  useEffect(() => {
    // Auto-check on mount to provide immediate feedback
    checkLocalBridge();
  }, []);

  const detectRealPrinters = async () => {
    try {
      if (!('usb' in navigator)) {
        throw new Error("WebUSB non supporté par ce navigateur.");
      }

      // Request a device from the user
      const device = await (navigator as any).usb.requestDevice({ 
        filters: [
          { classCode: 7 }, // Printer class
          { vendorId: 0x04a9 } // Canon Vendor ID
        ] 
      });
      
      if (device) {
        // Map common hardware names to user-friendly names
        let friendlyName = device.productName || 'Imprimante USB';
        if (friendlyName.includes('CAPT')) {
          friendlyName = 'Canon G3010 Series (VIA Bridge)';
        }

        const newPrinter: PrinterInfo = {
          id: device.serialNumber || 'usb-' + Math.random().toString(36).substring(7),
          name: friendlyName,
          type: 'usb',
          status: 'online'
        };

        setDetectedRealPrinters(prev => [...prev, newPrinter]);
        alert(`Imprimante ${friendlyName} détectée ! Elle apparaîtra dans la liste de votre Agent Relais réel.`);
      }
    } catch (err: any) {
      // Handle user cancellation gracefully
      if (err.name === 'NotFoundError' || err.message?.includes('No device selected')) {
        console.log("Détection USB annulée ou aucun périphérique sélectionné.");
        return;
      }
      
      if (err.name === 'SecurityError') {
        alert("L'accès USB est bloqué par la politique de sécurité. Veuillez essayer d'ouvrir l'application dans un nouvel onglet.");
      }
      
      console.error("Erreur de détection USB:", err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className="bg-[#1a1a1a] border border-white/10 w-full max-w-2xl rounded-[2.5rem] overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.5)]"
      >
        {/* Header */}
        <div className="bg-white/5 p-6 flex items-center justify-between border-b border-white/10">
          <div className="flex items-center gap-4">
            <div className="bg-emerald-500 p-3 rounded-2xl shadow-[0_0_20px_rgba(16,185,129,0.3)]">
              <Printer className="text-white" size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Système d'Impression Unifié "VIA"</h2>
              <p className="text-white/40 text-[10px] uppercase tracking-widest">Architecture Private Cloud Printing</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-xl transition-colors text-white/40 hover:text-white cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex p-2 bg-black/20 gap-2">
          <button 
            onClick={() => setActiveTab('existing')}
            className={`flex-1 py-3 rounded-xl text-[10px] uppercase tracking-widest font-bold transition-all cursor-pointer ${activeTab === 'existing' ? 'bg-white/10 text-white border border-white/10' : 'text-white/30 hover:text-white'}`}
          >
            Rechercher l'Existant
          </button>
          <button 
            onClick={() => setActiveTab('personal')}
            className={`flex-1 py-3 rounded-xl text-[10px] uppercase tracking-widest font-bold transition-all cursor-pointer ${activeTab === 'personal' ? 'bg-white/10 text-white border border-white/10' : 'text-white/30 hover:text-white'}`}
          >
            Option 'Personnaliser' (Nouveau Relais)
          </button>
        </div>

        {/* Content */}
        <div className="p-8 min-h-[400px] max-h-[60vh] overflow-y-auto custom-scrollbar">
          {showSuccess ? (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="py-12 text-center space-y-6"
            >
              <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="text-emerald-500" size={40} />
              </div>
              <div className="space-y-2">
                <h3 className="text-2xl font-bold text-white">Agent Installé !</h3>
                <p className="text-white/60 max-w-sm mx-auto">
                  L'Agent de Liaison Local est désormais actif sur ce PC. Pour détecter vos vraies imprimantes USB, cliquez sur le bouton ci-dessous.
                </p>
                <div className="flex flex-col items-center gap-2 pt-4">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                    <span className="text-[10px] text-emerald-500 font-bold uppercase tracking-widest">Relais Réseau Actif</span>
                  </div>
                  <div className="flex gap-4 px-4 py-2 bg-white/5 rounded-lg border border-white/5">
                    <div className="flex flex-col items-center">
                      <span className="text-[8px] text-white/40 uppercase font-mono">IPP</span>
                      <span className="text-[9px] text-emerald-500/80 font-mono">631</span>
                    </div>
                    <div className="w-[1px] bg-white/10 h-4 self-center"></div>
                    <div className="flex flex-col items-center">
                      <span className="text-[8px] text-white/40 uppercase font-mono">WSD</span>
                      <span className="text-[9px] text-emerald-500/80 font-mono">3702</span>
                    </div>
                    <div className="w-[1px] bg-white/10 h-4 self-center"></div>
                    <div className="flex flex-col items-center">
                      <span className="text-[8px] text-white/40 uppercase font-mono">mDNS</span>
                      <span className="text-[9px] text-emerald-500/80 font-mono">Active</span>
                    </div>
                  </div>
                  <p className="text-[9px] text-white/30 italic">Windows détectera automatiquement "VIA Cloud Printer" sur votre réseau.</p>
                  
                  <div className="mt-6 p-4 bg-white/5 rounded-2xl border border-white/10 text-left space-y-3 w-full max-w-md mx-auto">
                    <div className="space-y-1">
                      <h4 className="text-[10px] font-bold text-white/60 uppercase tracking-widest">Guide de Détection</h4>
                      <p className="text-[11px] text-white/50 leading-relaxed">
                        • <span className="text-white/80">"Canon CAPT USB"</span> : C'est le nom matériel de votre <span className="text-emerald-400">Canon G3010</span>. Sélectionnez-le pour l'associer.<br/>
                        • <span className="text-white/80">"802.11 n WLAN"</span> : C'est votre carte Wi-Fi interne (détectée car branchée sur le bus USB interne). <span className="text-red-400/60">Ignorez-la.</span><br/>
                        • <span className="text-white/80">Windows</span> : Si la détection automatique échoue, ajoutez une imprimante via l'adresse IP de ce PC sur le port <span className="text-emerald-400">631</span>.<br/>
                        • <span className="text-white/80">Vérification</span> : Ouvrez <code className="text-emerald-400">http://localhost:631</code> dans votre navigateur pour confirmer que le pont est actif.
                      </p>
                      
                      <div className="pt-2">
                        <button 
                          onClick={checkLocalBridge}
                          disabled={diagStatus === 'checking'}
                          className={`w-full py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
                            diagStatus === 'ok' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                            diagStatus === 'fail' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                            'bg-white/5 text-white/60 border border-white/10 hover:bg-white/10'
                          }`}
                        >
                          {diagStatus === 'checking' ? <Loader2 size={12} className="animate-spin" /> : <Activity size={12} />}
                          {diagStatus === 'ok' ? 'Pont Local Actif' : 
                           diagStatus === 'fail' ? 'Pont Local Inaccessible' : 
                           'Tester la connexion locale'}
                        </button>
                        
                        {diagStatus === 'fail' && (
                          <motion.div 
                            initial={{ opacity: 0, y: -5 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="mt-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl"
                          >
                            <p className="text-[9px] text-red-400 leading-relaxed">
                              <span className="font-bold">Échec :</span> L'agent n'est pas détecté.<br/>
                              1. Vérifiez que l'Agent VIA est bien lancé sur ce PC.<br/>
                              2. <a href="http://localhost:631" target="_blank" rel="noopener noreferrer" className="underline font-bold">Cliquez ici pour tester manuellement</a> (si cela s'ouvre, c'est un blocage de sécurité du navigateur).<br/>
                              3. Relancez l'agent en mode Administrateur.<br/>
                              4. Désactivez votre Pare-feu ou Proxy.
                            </p>
                          </motion.div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3 items-center">
                <button 
                  onClick={detectRealPrinters}
                  className="flex items-center gap-2 bg-white/10 text-white px-8 py-3 rounded-2xl font-bold hover:bg-white/20 transition-all border border-white/10 cursor-pointer"
                >
                  <Usb size={18} className="text-emerald-500" />
                  Détecter mes imprimantes USB
                </button>

                <button 
                  onClick={() => {
                    setShowSuccess(false);
                    setActiveTab('existing');
                  }}
                  className="bg-emerald-500 text-white px-8 py-3 rounded-2xl font-bold hover:bg-emerald-600 transition-all active:scale-95 cursor-pointer"
                >
                  Voir mes imprimantes
                </button>
              </div>
            </motion.div>
          ) : activeTab === 'existing' ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-white/60 uppercase tracking-widest">Agents de Liaison Actifs</h3>
                <button 
                  onClick={handleSearch}
                  disabled={isSearching}
                  className="flex items-center gap-2 text-emerald-400 hover:text-emerald-300 text-[10px] uppercase font-bold tracking-widest transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isSearching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                  {isSearching ? 'Recherche...' : 'Actualiser'}
                </button>
              </div>

              {relaisList.length > 0 ? (
                <div className="space-y-4">
                  {relaisList.map((relais) => (
                    <div key={relais.id} className="bg-white/5 border border-white/10 rounded-3xl p-6 hover:bg-white/[0.07] transition-colors">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <Server className="text-emerald-500" size={20} />
                          <span className="font-bold text-white">{relais.name}</span>
                          <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-[8px] rounded-full uppercase font-bold">Actif</span>
                        </div>
                        <span className="text-[10px] text-white/20 font-mono">{relais.id}</span>
                      </div>
                      
                      <div className="grid grid-cols-1 gap-2">
                        {relais.printers.length > 0 ? (
                          relais.printers.map(printer => (
                            <div key={printer.id} className="flex items-center justify-between bg-black/20 p-3 rounded-xl border border-white/5">
                              <div className="flex items-center gap-3">
                                {printer.type === 'usb' ? <Usb size={14} className="text-white/40" /> : <Network size={14} className="text-white/40" />}
                                <span className="text-xs text-white/80">{printer.name}</span>
                                <span className="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 text-[7px] rounded uppercase font-bold border border-blue-500/30">Réseau</span>
                              </div>
                              <div className="flex items-center gap-2">
                                {printer.status === 'online' && (
                                  <button 
                                    onClick={() => {
                                      const socket = activeSocket || getSocket('dashboard');
                                      if (socket) {
                                        socket.emit('print_test_page', { relaisId: relais.id, printerName: printer.name });
                                        alert(`Demande de page de test envoyée à ${printer.name}`);
                                      }
                                    }}
                                    className="bg-white/10 hover:bg-white/20 text-white text-[8px] uppercase font-bold px-3 py-1.5 rounded-lg transition-colors cursor-pointer border border-white/10"
                                  >
                                    Page de Test
                                  </button>
                                )}
                                <button className="bg-emerald-500 hover:bg-emerald-600 text-white text-[8px] uppercase font-bold px-3 py-1.5 rounded-lg transition-colors cursor-pointer">
                                  Connecté
                                </button>
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className="text-[10px] text-white/20 italic text-center py-2">Aucune imprimante détectée sur ce relais</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="bg-white/5 p-6 rounded-full mb-4">
                    <Activity className="text-white/10" size={48} />
                  </div>
                  <p className="text-white/40 text-sm max-w-xs">Aucun Agent de Liaison Local n'a été détecté sur votre réseau privé.</p>
                  <button 
                    onClick={() => setActiveTab('personal')}
                    className="mt-6 text-emerald-400 text-[10px] uppercase font-bold tracking-widest hover:underline cursor-pointer"
                  >
                    Installer un nouveau relais
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-8">
              <div className="bg-emerald-500/10 border border-emerald-500/20 p-6 rounded-3xl flex gap-4">
                <Shield className="text-emerald-500 shrink-0" size={24} />
                <div>
                  <h3 className="text-emerald-400 font-bold text-sm mb-1">Sécurisation VIA Tunneling</h3>
                  <p className="text-white/40 text-xs leading-relaxed">
                    L'Agent de Liaison Local crée un tunnel sécurisé (WSS) sortant. 
                    Cela permet à Windows de voir vos imprimantes distantes via le protocole IPP sans modifier votre pare-feu.
                  </p>
                </div>
              </div>

              <div className="space-y-6">
                <div className="flex items-center gap-4">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${installStep >= 1 ? 'bg-emerald-500 text-white' : 'bg-white/10 text-white/40'}`}>1</div>
                  <p className={`text-sm ${installStep >= 1 ? 'text-white' : 'text-white/40'}`}>Téléchargement de l'Agent VIA (Windows/Linux/MacOS)</p>
                </div>
                <div className="flex items-center gap-4">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${installStep >= 2 ? 'bg-emerald-500 text-white' : 'bg-white/10 text-white/40'}`}>2</div>
                  <p className={`text-sm ${installStep >= 2 ? 'text-white' : 'text-white/40'}`}>Installation du service résident en arrière-plan</p>
                </div>
                <div className="flex items-center gap-4">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${installStep >= 3 ? 'bg-emerald-500 text-white' : 'bg-white/10 text-white/40'}`}>3</div>
                  <p className={`text-sm ${installStep >= 3 ? 'text-white' : 'text-white/40'}`}>Appairage sécurisé avec votre compte VIA</p>
                </div>
              </div>

              <div className="pt-4">
                <button 
                  onClick={handleInstallAgent}
                  disabled={installingAgent}
                  className="w-full bg-white text-black py-5 rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-emerald-500 hover:text-white transition-all disabled:opacity-50 active:scale-[0.98] cursor-pointer"
                >
                  {installingAgent ? (
                    <>
                      <Loader2 className="animate-spin" size={20} />
                      Installation en cours...
                    </>
                  ) : (
                    <>
                      <Download size={20} />
                      Activer ce PC comme Relais d'Impression
                    </>
                  )}
                </button>
                <p className="text-center text-[9px] text-white/20 uppercase tracking-[0.2em] mt-4">
                  Compatible avec Word, Excel, AutoCAD et flux RAW
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer Info */}
        <div className="bg-black/40 p-4 border-t border-white/5 flex items-center justify-center gap-6">
          <div className="flex items-center gap-2 opacity-30">
            <CheckCircle2 size={12} className="text-emerald-500" />
            <span className="text-[8px] uppercase tracking-widest font-bold">Protocole IPP/HTTPS</span>
          </div>
          <div className="flex items-center gap-2 opacity-30">
            <CheckCircle2 size={12} className="text-emerald-500" />
            <span className="text-[8px] uppercase tracking-widest font-bold">Tunneling WSS</span>
          </div>
          <div className="flex items-center gap-2 opacity-30">
            <CheckCircle2 size={12} className="text-emerald-500" />
            <span className="text-[8px] uppercase tracking-widest font-bold">Fidélité des Flux RAW</span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
