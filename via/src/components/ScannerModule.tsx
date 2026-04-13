import React, { useState, useRef, useEffect } from 'react';
import { Camera, X, Check, RotateCcw, Maximize, FileText, Loader2, Send, Zap, ZapOff, ArrowLeft, RotateCw, Battery, Signal } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Point {
  x: number;
  y: number;
}

interface ScannerModuleProps {
  onClose: () => void;
  onSend: (data: any, type: string, metadata?: any) => void;
}

const PAPER_FORMATS = [
  { name: 'A4', ratio: 1 / 1.414 },
];

export default function ScannerModule({ onClose, onSend }: ScannerModuleProps) {
  const [step, setStep] = useState<'capture' | 'adjust' | 'process' | 'sending'>('capture');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [corners, setCorners] = useState<Point[]>([
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.9, y: 0.9 },
    { x: 0.1, y: 0.9 },
  ]);
  const [selectedFormat, setSelectedFormat] = useState(PAPER_FORMATS[0]);
  const [processedImage, setProcessedImage] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<'Original' | 'Photo' | 'Docs' | 'Clair' | 'N/B'>('Docs');
  const [rotation, setRotation] = useState(0);
  const [currentTime, setCurrentTime] = useState('4:02 PM');
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isMounted = useRef(true);
  const cameraInstanceId = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState<number | null>(null);
  const [flashOn, setFlashOn] = useState(false);
  const [hasFlash, setHasFlash] = useState(false);
  const [brightness, setBrightness] = useState(1.0);
  const [contrast, setContrast] = useState(1.0);
  const [isFocusing, setIsFocusing] = useState(false);
  const [focusPoint, setFocusPoint] = useState<{x: number, y: number} | null>(null);
  const [autoDetecting, setAutoDetecting] = useState(true);

  // Auto-detection loop
  useEffect(() => {
    if (step !== 'capture' || !autoDetecting) return;

    const interval = setInterval(() => {
      detectDocument();
    }, 600);

    return () => clearInterval(interval);
  }, [step, autoDetecting]);

  const detectDocument = () => {
    if (!videoRef.current || videoRef.current.readyState < 2) return;

    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    const scale = 0.25; // Process at lower resolution for speed
    canvas.width = video.videoWidth * scale;
    canvas.height = video.videoHeight * scale;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Simple edge detection & contour finding
    // 1. Grayscale & Blur
    const gray = new Uint8Array(canvas.width * canvas.height);
    for (let i = 0; i < data.length; i += 4) {
      gray[i / 4] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    }

    // 2. Adaptive Thresholding
    const thresholded = new Uint8Array(gray.length);
    const blockSize = 15;
    const C = 5;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        let sum = 0;
        let count = 0;
        for (let ky = -Math.floor(blockSize / 2); ky <= Math.floor(blockSize / 2); ky++) {
          for (let kx = -Math.floor(blockSize / 2); kx <= Math.floor(blockSize / 2); kx++) {
            const py = y + ky;
            const px = x + kx;
            if (py >= 0 && py < canvas.height && px >= 0 && px < canvas.width) {
              sum += gray[py * canvas.width + px];
              count++;
            }
          }
        }
        thresholded[y * canvas.width + x] = gray[y * canvas.width + x] > (sum / count - C) ? 0 : 255;
      }
    }

    // 3. Find largest "blob" or rectangle (simplified)
    // For now, we'll look for the bounding box of the most "active" area
    let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
    let pointsCount = 0;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        if (thresholded[y * canvas.width + x] === 255) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          pointsCount++;
        }
      }
    }

    // If area is significant (at least 15% of screen), update corners
    const area = (maxX - minX) * (maxY - minY);
    if (pointsCount > (canvas.width * canvas.height * 0.05) && area > (canvas.width * canvas.height * 0.15)) {
      const padding = 0.02;
      const newCorners = [
        { x: Math.max(0, minX / canvas.width - padding), y: Math.max(0, minY / canvas.height - padding) },
        { x: Math.min(1, maxX / canvas.width + padding), y: Math.max(0, minY / canvas.height - padding) },
        { x: Math.min(1, maxX / canvas.width + padding), y: Math.min(1, maxY / canvas.height + padding) },
        { x: Math.max(0, minX / canvas.width - padding), y: Math.min(1, maxY / canvas.height + padding) },
      ];
      
      // Smooth transition - faster for better responsiveness
      setCorners(prev => prev.map((p, i) => ({
        x: p.x * 0.6 + newCorners[i].x * 0.4,
        y: p.y * 0.6 + newCorners[i].y * 0.4
      })));
    }
  };

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }));
    }, 1000);

    // Battery Sync
    if ('getBattery' in navigator) {
      (navigator as any).getBattery().then((battery: any) => {
        const updateBattery = () => setBatteryLevel(Math.round(battery.level * 100));
        updateBattery();
        battery.addEventListener('levelchange', updateBattery);
      });
    }

    return () => clearInterval(timer);
  }, []);

  // Start camera
  useEffect(() => {
    isMounted.current = true;
    let timer: NodeJS.Timeout;
    if (step === 'capture') {
      timer = setTimeout(() => {
        if (isMounted.current) startCamera();
      }, 800);
    }
    return () => {
      isMounted.current = false;
      if (timer) clearTimeout(timer);
      stopCamera();
    };
  }, [step]);

  const startCamera = async () => {
    if (!isMounted.current) return;
    const instanceId = ++cameraInstanceId.current;
    setCameraError(null);
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError("Votre navigateur ne supporte pas l'accès à la caméra.");
      return;
    }

    try {
      // Stop any existing tracks first
      stopCamera();
      
      // Additional small delay to ensure hardware is fully released
      await new Promise(resolve => setTimeout(resolve, 600));

      if (!isMounted.current || instanceId !== cameraInstanceId.current) return;

      // Standard HD constraints - avoid 4K to reduce lag and hardware strain
      const constraints = {
        video: {
          facingMode: 'environment',
          width: { ideal: 2560 }, // Increased ideal resolution for better detail
          height: { ideal: 1440 },
          frameRate: { ideal: 30 }
        },
        audio: false
      };

      console.log(`Starting camera instance ${instanceId}...`);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // CRITICAL: If we unmounted or a new instance started, stop this one
      if (!isMounted.current || instanceId !== cameraInstanceId.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        
        // Explicitly call play() for mobile browsers
        try {
          await videoRef.current.play();
        } catch (playErr) {
          console.warn("Video play() failed:", playErr);
        }
        
        const track = stream.getVideoTracks()[0];
        // ... (rest of the logic)
        
        // Apply focus and exposure constraints
        if (track && typeof track.applyConstraints === 'function') {
          try {
            const capabilities = track.getCapabilities() as any;
            const constraints: any = {
              advanced: [
                { focusMode: 'continuous' },
                { exposureMode: 'continuous' },
                { whiteBalanceMode: 'continuous' }
              ]
            };

            // Add exposure compensation if supported
            if (capabilities.exposureCompensation) {
              constraints.advanced[0].exposureCompensation = capabilities.exposureCompensation.max || 0;
            }

            await track.applyConstraints(constraints);
          } catch (constErr) {
            console.warn("Advanced constraints failed:", constErr);
          }
        }

        // Safely check for flash capability
        if (track && typeof track.getCapabilities === 'function') {
          try {
            const capabilities = track.getCapabilities() as any;
            setHasFlash(!!capabilities.torch);
          } catch (capErr) {
            console.warn("Capabilities check failed:", capErr);
          }
        }
      }
    } catch (err) {
      if (!isMounted.current) return;
      console.error("Primary camera error:", err);
      // Fallback to absolute basic video
      try {
        const basicStream = await navigator.mediaDevices.getUserMedia({ 
          video: { facingMode: 'environment' },
          audio: false 
        });
        
        if (!isMounted.current) {
          basicStream.getTracks().forEach(t => t.stop());
          return;
        }

        streamRef.current = basicStream;
        if (videoRef.current) {
          videoRef.current.srcObject = basicStream;
          await videoRef.current.play();
        }
      } catch (fallbackErr) {
        if (!isMounted.current) return;
        console.error("Fallback camera error:", fallbackErr);
        setCameraError("Impossible d'accéder à la caméra. Veuillez vérifier les permissions.");
      }
    }
  };

  const toggleFlash = async () => {
    if (!videoRef.current || !videoRef.current.srcObject) return;
    const stream = videoRef.current.srcObject as MediaStream;
    const track = stream.getVideoTracks()[0];
    
    try {
      const capabilities = track.getCapabilities() as any;
      if (capabilities.torch) {
        const newFlashState = !flashOn;
        await track.applyConstraints({
          advanced: [{ torch: newFlashState }]
        } as any);
        setFlashOn(newFlashState);
      }
    } catch (err) {
      console.error("Flash error:", err);
    }
  };

  const handleTapToFocus = async (e: React.MouseEvent | React.TouchEvent) => {
    if (!videoRef.current || !videoRef.current.srcObject) return;
    const stream = videoRef.current.srcObject as MediaStream;
    const track = stream.getVideoTracks()[0];
    if (!track || typeof track.applyConstraints !== 'function') return;

    const rect = videoRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;

    setFocusPoint({ x: clientX, y: clientY });
    setIsFocusing(true);

    try {
      const capabilities = track.getCapabilities() as any;
      const constraints: any = {
        advanced: [
          { focusMode: 'manual', focusDistance: 0 }, // Reset to manual then back to continuous
        ]
      };

      // Some devices support focusMode: 'single-shot' or 'manual' with focusDistance
      // We'll try to trigger a re-focus by switching modes
      await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] } as any);
      
      setTimeout(() => {
        setIsFocusing(false);
        setFocusPoint(null);
      }, 1000);
    } catch (err) {
      console.warn("Focus constraints failed:", err);
      setIsFocusing(false);
      setFocusPoint(null);
    }
  };

  const stopCamera = () => {
    console.log("Stopping camera...");
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        track.stop();
        console.log("Track stopped:", track.label);
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
      videoRef.current.removeAttribute('src'); // More aggressive cleanup
      videoRef.current.load(); // Clear buffer
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    // Use the full resolution of the video stream
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0);
      // High quality initial capture
      setCapturedImage(canvas.toDataURL('image/jpeg', 1.0));
      setStep('adjust');
      
      // Turn off flash after capture if it was on
      if (flashOn) {
        toggleFlash();
      }
    }
  };

  const getMidPoints = () => {
    return [
      { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 }, // Top
      { x: (corners[1].x + corners[2].x) / 2, y: (corners[1].y + corners[2].y) / 2 }, // Right
      { x: (corners[2].x + corners[3].x) / 2, y: (corners[2].y + corners[3].y) / 2 }, // Bottom
      { x: (corners[3].x + corners[0].x) / 2, y: (corners[3].y + corners[0].y) / 2 }, // Left
    ];
  };

  const handleTouchMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (isDragging === null || !containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    
    const newCorners = [...corners];
    
    if (isDragging < 4) {
      // Corner dragging
      newCorners[isDragging] = { x, y };
    } else {
      // Midpoint dragging
      const midIdx = isDragging - 4;
      const p1Idx = midIdx;
      const p2Idx = (midIdx + 1) % 4;
      
      const dx = x - (corners[p1Idx].x + corners[p2Idx].x) / 2;
      const dy = y - (corners[p1Idx].y + corners[p2Idx].y) / 2;
      
      newCorners[p1Idx] = { x: corners[p1Idx].x + dx, y: corners[p1Idx].y + dy };
      newCorners[p2Idx] = { x: corners[p2Idx].x + dx, y: corners[p2Idx].y + dy };
    }
    
    setCorners(newCorners);
  };

  const processImage = async () => {
    if (!capturedImage || !canvasRef.current) return;
    setStep('process');
    
    const img = new Image();
    img.src = capturedImage;
    await new Promise(resolve => img.onload = resolve);

    const canvas = canvasRef.current;
    const outputWidth = 2400;
    const outputHeight = Math.round(outputWidth / selectedFormat.ratio);
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!ctx) return;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // 1. Perspective Warp
    warpPerspective(img, canvas, corners);

    // 2. Apply Filters
    applyFilters(ctx, outputWidth, outputHeight);

    setProcessedImage(canvas.toDataURL('image/jpeg', 0.9));
  };

  const applyFilters = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    if (activeFilter === 'Original') return;

    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    if (activeFilter === 'Photo') {
      // Subtle enhancement
      for (let i = 0; i < data.length; i += 4) {
        data[i] = Math.min(255, data[i] * 1.1);
        data[i+1] = Math.min(255, data[i+1] * 1.1);
        data[i+2] = Math.min(255, data[i+2] * 1.1);
      }
      ctx.putImageData(imageData, 0, 0);
      ctx.filter = 'contrast(1.2) saturate(1.1)';
      ctx.drawImage(ctx.canvas, 0, 0);
      return;
    }

    // Background Estimation for Docs, Clear, B&W
    const scale = 8;
    const sw = Math.ceil(w / scale);
    const sh = Math.ceil(h / scale);
    const bgMap = new Uint8ClampedArray(sw * sh);
    
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        let maxLum = 0;
        const startY = Math.max(0, y * scale - 16);
        const endY = Math.min(h, y * scale + 16);
        const startX = Math.max(0, x * scale - 16);
        const endX = Math.min(w, x * scale + 16);
        
        for (let sy = startY; sy < endY; sy += 4) {
          for (let sx = startX; sx < endX; sx += 4) {
            const idx = (sy * w + sx) * 4;
            const lum = (data[idx] * 0.299 + data[idx+1] * 0.587 + data[idx+2] * 0.114);
            if (lum > maxLum) maxLum = lum;
          }
        }
        bgMap[y * sw + x] = maxLum;
      }
    }

    for (let y = 0; y < h; y++) {
      const row = y * w;
      const bgY = Math.floor(y / scale);
      for (let x = 0; x < w; x++) {
        const idx = (row + x) * 4;
        const bgX = Math.floor(x / scale);
        const localMax = bgMap[bgY * sw + bgX];
        
        let r = data[idx];
        let g = data[idx + 1];
        let b = data[idx + 2];

        if (activeFilter === 'N/B') {
          const gray = (r * 0.299 + g * 0.587 + b * 0.114);
          r = g = b = gray;
        }
        
        const lum = (r * 0.299 + g * 0.587 + b * 0.114);
          if (activeFilter === 'Docs') {
          // Adaptive thresholding based on local maximum
          // We want to keep the background clean but avoid overexposure
          const threshold = localMax * 0.92; // Even more selective
          
          if (lum > threshold) {
            // Background: Whiten but keep it much more natural
            // Significantly lowering targetWhite to reduce brightness (from 220 to 195)
            const targetWhite = Math.min(195, localMax); 
            const gain = targetWhite / Math.max(localMax, 1);
            r = Math.min(255, r * gain);
            g = Math.min(255, g * gain);
            b = Math.min(255, b * gain);
          } else {
            // Text/Ink: Increase contrast but keep it darker
            const contrastFactor = 1.2;
            r = Math.max(0, (r - 128) * contrastFactor + 128 - 60);
            g = Math.max(0, (g - 128) * contrastFactor + 128 - 60);
            b = Math.max(0, (g - 128) * contrastFactor + 128 - 60);
          }
        } else if (activeFilter === 'Clair') {
          // Soft whitening - even more subtle to avoid overexposure
          const gain = 195 / Math.max(localMax, 230);
          r = Math.min(255, r * gain + (255 - r * gain) * 0.1);
          g = Math.min(255, g * gain + (255 - g * gain) * 0.1);
          b = Math.min(255, b * gain + (255 - b * gain) * 0.1);
        }
        
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
      }
    }
    
    ctx.putImageData(imageData, 0, 0);

    if (activeFilter === 'Docs' || activeFilter === 'N/B') {
      ctx.globalAlpha = 0.3;
      ctx.filter = 'contrast(1.5) grayscale(100%)';
      ctx.drawImage(ctx.canvas, 0, 0);
      ctx.globalAlpha = 1.0;
      ctx.filter = 'none';
    }
  };

  // Homography / Perspective Warp implementation
  const warpPerspective = (img: HTMLImageElement, canvas: HTMLCanvasElement, srcPoints: Point[]) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dstW = canvas.width;
    const dstH = canvas.height;

    // Map normalized srcPoints to image pixels
    const src = srcPoints.map(p => ({ x: p.x * img.width, y: p.y * img.height }));
    const dst = [
      { x: 0, y: 0 },
      { x: dstW, y: 0 },
      { x: dstW, y: dstH },
      { x: 0, y: dstH }
    ];

    // Subdivide into 4 triangles for better perspective
    const srcCenter = {
      x: (src[0].x + src[1].x + src[2].x + src[3].x) / 4,
      y: (src[0].y + src[1].y + src[2].y + src[3].y) / 4
    };
    const dstCenter = { x: dstW / 2, y: dstH / 2 };

    const drawTriangle = (s0: Point, s1: Point, s2: Point, d0: Point, d1: Point, d2: Point) => {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(d0.x, d0.y);
      ctx.lineTo(d1.x, d1.y);
      ctx.lineTo(d2.x, d2.y);
      ctx.closePath();
      ctx.clip();

      const denom = (s0.x - s2.x) * (s1.y - s0.y) - (s0.x - s1.x) * (s2.y - s0.y);
      if (denom === 0) return;
      
      const a = ((d0.x - d2.x) * (s1.y - s0.y) - (d0.x - d1.x) * (s2.y - s0.y)) / denom;
      const b = ((d0.y - d2.y) * (s1.y - s0.y) - (d0.y - d1.y) * (s2.y - s0.y)) / denom;
      const c = ((d0.x - d1.x) * (s2.x - s0.x) - (d0.x - d2.x) * (s1.x - s0.x)) / denom;
      const d = ((d0.y - d1.y) * (s2.x - s0.x) - (d0.y - d2.y) * (s1.x - s0.x)) / denom;
      const e = d0.x - a * s0.x - c * s0.y;
      const f = d0.y - b * s0.x - d * s0.y;

      ctx.setTransform(a, b, c, d, e, f);
      ctx.drawImage(img, 0, 0);
      ctx.restore();
    };

    // Draw 4 triangles
    drawTriangle(src[0], src[1], srcCenter, dst[0], dst[1], dstCenter);
    drawTriangle(src[1], src[2], srcCenter, dst[1], dst[2], dstCenter);
    drawTriangle(src[2], src[3], srcCenter, dst[2], dst[3], dstCenter);
    drawTriangle(src[3], src[0], srcCenter, dst[3], dst[0], dstCenter);
  };

  const handleFinalSend = async () => {
    if (!processedImage || !canvasRef.current) return;
    setStep('sending');

    // Apply rotation to final canvas before sending
    const finalCanvas = document.createElement('canvas');
    const isPortrait = Math.abs(rotation % 180) === 0;
    finalCanvas.width = isPortrait ? canvasRef.current.width : canvasRef.current.height;
    finalCanvas.height = isPortrait ? canvasRef.current.height : canvasRef.current.width;
    const fctx = finalCanvas.getContext('2d');
    
    if (fctx) {
      fctx.translate(finalCanvas.width / 2, finalCanvas.height / 2);
      fctx.rotate((rotation * Math.PI) / 180);
      fctx.drawImage(canvasRef.current, -canvasRef.current.width / 2, -canvasRef.current.height / 2);
      
      const finalDataUrl = finalCanvas.toDataURL('image/jpeg', 0.85);
      
      try {
        const response = await fetch(finalDataUrl);
        const blob = await response.blob();
        const buffer = await blob.arrayBuffer();
        onSend(buffer, 'photo', {
          fileName: `scan_${selectedFormat.name}_${Date.now()}.jpg`,
          mimeType: 'image/jpeg'
        });
      } catch (err) {
        console.error("Error converting scan to binary:", err);
        onSend(finalDataUrl, 'photo');
      }
    } else {
      onSend(processedImage, 'photo');
    }

    setTimeout(() => {
      onClose();
    }, 1500);
  };

  return (
    <div className="fixed inset-0 z-[200] bg-[#4CAF50] flex items-center justify-center p-4">
      {/* Smartphone Frame Simulation */}
      <div className="w-full max-w-[400px] aspect-[9/19.5] bg-black rounded-[3rem] border-[8px] border-[#1a1a1a] shadow-2xl overflow-hidden flex flex-col relative">
        
        {/* Header / Status Bar */}
        <div className="bg-[#1a3a3a] px-4 pt-6 pb-2 flex justify-between items-center text-white/90">
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-full transition-colors">
              <ArrowLeft size={20} />
            </button>
            <h2 className="font-medium text-sm">Scan (Handwriting)</h2>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-medium">
            <Signal size={12} />
            <span>{currentTime}</span>
            <div className="flex items-center gap-1">
              <Battery size={14} className="rotate-90" />
              <span>{batteryLevel !== null ? `${batteryLevel}%` : '85%'}</span>
            </div>
          </div>
        </div>

        {/* Filter Options Bar */}
        <div className="bg-[#1a3a3a] border-t border-white/5 px-2 py-1 flex justify-around items-center">
          {(['Original', 'Photo', 'Docs', 'Clair', 'N/B'] as const).map(filter => (
            <button
              key={filter}
              onClick={() => {
                setActiveFilter(filter);
                if (step === 'process') processImage();
              }}
              className={`px-3 py-1.5 rounded text-[10px] font-bold transition-all ${activeFilter === filter ? 'bg-white/20 text-white border-b-2 border-emerald-400' : 'text-white/40'}`}
            >
              {filter}
            </button>
          ))}
        </div>

        {/* Main Content */}
        <div className="flex-1 relative bg-neutral-900 flex items-center justify-center overflow-hidden">
          {step === 'capture' && (
            <div className="relative w-full h-full flex items-center justify-center">
              {cameraError ? (
                <div className="text-center p-8 space-y-6">
                  <div className="bg-zinc-500/20 p-6 rounded-full inline-block">
                    <Camera className="text-zinc-400" size={48} />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-xl font-bold">Caméra Indisponible</h3>
                    <p className="text-white/40 text-sm max-w-xs mx-auto">
                      L'appareil photo ne s'est pas ouvert.
                    </p>
                  </div>
                  <button 
                    onClick={startCamera}
                    className="px-8 py-4 bg-white text-black rounded-2xl font-bold active:scale-95 transition-transform flex items-center justify-center gap-2 mx-auto cursor-pointer"
                  >
                    <RotateCcw size={18} />
                    Réessayer
                  </button>
                </div>
              ) : (
                <>
                  <video 
                    ref={videoRef} 
                    autoPlay 
                    playsInline 
                    muted
                    onClick={handleTapToFocus}
                    onTouchStart={handleTapToFocus}
                    className="w-full h-full object-cover bg-black cursor-crosshair"
                  />
                  
                  {/* Focus Indicator */}
                  <AnimatePresence>
                    {focusPoint && (
                      <motion.div 
                        initial={{ scale: 2, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.5, opacity: 0 }}
                        className="absolute pointer-events-none z-50"
                        style={{ left: focusPoint.x - 30, top: focusPoint.y - 30 }}
                      >
                        <div className="w-[60px] h-[60px] border-2 border-yellow-400 rounded-lg flex items-center justify-center">
                          <div className="w-1 h-1 bg-yellow-400 rounded-full"></div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Overlay Guides & Auto-Crop Border */}
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    {autoDetecting ? (
                      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                        <polygon 
                          points={corners.map(p => `${p.x * 100},${p.y * 100}`).join(' ')} 
                          fill="rgba(16, 185, 129, 0.25)" 
                          stroke="#10b981" 
                          strokeWidth="1.5"
                          strokeDasharray="2 1"
                          className="animate-pulse"
                        />
                        {/* Precision Grid during Auto-detection */}
                        <line x1="0" y1="33" x2="100" y2="33" stroke="rgba(16, 185, 129, 0.1)" strokeWidth="0.5" />
                        <line x1="0" y1="66" x2="100" y2="66" stroke="rgba(16, 185, 129, 0.1)" strokeWidth="0.5" />
                        <line x1="33" y1="0" x2="33" y2="100" stroke="rgba(16, 185, 129, 0.1)" strokeWidth="0.5" />
                        <line x1="66" y1="0" x2="66" y2="100" stroke="rgba(16, 185, 129, 0.1)" strokeWidth="0.5" />
                      </svg>
                    ) : (
                      <div className="w-[85%] h-[80%] border-2 border-white/20 rounded-2xl relative">
                        <div className="absolute top-0 left-0 w-10 h-10 border-t-4 border-l-4 border-emerald-500 rounded-tl-xl"></div>
                        <div className="absolute top-0 right-0 w-10 h-10 border-t-4 border-r-4 border-emerald-500 rounded-tr-xl"></div>
                        <div className="absolute bottom-0 left-0 w-10 h-10 border-b-4 border-l-4 border-emerald-500 rounded-bl-xl"></div>
                        <div className="absolute bottom-0 right-0 w-10 h-10 border-b-4 border-r-4 border-emerald-500 rounded-br-xl"></div>
                      </div>
                    )}
                  </div>
                  
                  {/* Auto-detection Indicator */}
                  <div className="absolute top-20 left-6">
                    <button 
                      onClick={() => setAutoDetecting(!autoDetecting)}
                      className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all flex items-center gap-2 ${autoDetecting ? 'bg-emerald-500 text-white' : 'bg-black/40 text-white/60 border border-white/10'}`}
                    >
                      <div className={`w-2 h-2 rounded-full ${autoDetecting ? 'bg-white animate-pulse' : 'bg-white/20'}`}></div>
                      {autoDetecting ? 'Auto-Crop On' : 'Auto-Crop Off'}
                    </button>
                  </div>

                  {/* Flash Toggle */}
                  {hasFlash && (
                    <div className="absolute top-6 right-6">
                      <button 
                        onClick={toggleFlash}
                        className={`p-4 rounded-full transition-all ${flashOn ? 'bg-yellow-400 text-black shadow-lg shadow-yellow-400/50' : 'bg-black/40 text-white backdrop-blur-md border border-white/10'}`}
                      >
                        {flashOn ? <Zap size={24} fill="currentColor" /> : <ZapOff size={24} />}
                      </button>
                    </div>
                  )}

                  {/* Capture Button */}
                  <div className="absolute bottom-12 left-0 right-0 flex justify-center">
                    <button 
                      onClick={capturePhoto}
                      className="w-20 h-20 bg-white rounded-full border-4 border-white/30 flex items-center justify-center active:scale-90 transition-transform cursor-pointer"
                    >
                      <div className="w-16 h-16 bg-white rounded-full border-2 border-black/10"></div>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {step === 'adjust' && capturedImage && (
            <div className="w-full h-full flex flex-col p-0 overflow-hidden bg-black">
              <div 
                ref={containerRef}
                className="flex-1 relative bg-black overflow-hidden"
                onMouseMove={handleTouchMove}
                onTouchMove={handleTouchMove}
                onMouseUp={() => setIsDragging(null)}
                onTouchEnd={() => setIsDragging(null)}
              >
                <img src={capturedImage} className="w-full h-full object-contain opacity-80" alt="Captured" />
                
                {/* Corner Handles & Interactive Grid */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
                  <polygon 
                    points={corners.map(p => `${p.x * 100},${p.y * 100}`).join(' ')} 
                    fill="rgba(16, 185, 129, 0.15)" 
                    stroke="#10b981" 
                    strokeWidth="1"
                    strokeLinejoin="round"
                  />
                  {/* Precision Grid Lines (Horizontal & Vertical) */}
                  {/* Vertical lines connecting midpoints */}
                  <line 
                    x1={`${getMidPoints()[0].x * 100}`} y1={`${getMidPoints()[0].y * 100}`} 
                    x2={`${getMidPoints()[2].x * 100}`} y2={`${getMidPoints()[2].y * 100}`} 
                    stroke="rgba(16, 185, 129, 0.4)" strokeWidth="0.5" strokeDasharray="2 2" 
                  />
                  {/* Horizontal lines connecting midpoints */}
                  <line 
                    x1={`${getMidPoints()[3].x * 100}`} y1={`${getMidPoints()[3].y * 100}`} 
                    x2={`${getMidPoints()[1].x * 100}`} y2={`${getMidPoints()[1].y * 100}`} 
                    stroke="rgba(16, 185, 129, 0.4)" strokeWidth="0.5" strokeDasharray="2 2" 
                  />
                  
                  {/* Diagonal Grid Lines */}
                  <line 
                    x1={`${corners[0].x * 100}`} y1={`${corners[0].y * 100}`} 
                    x2={`${corners[2].x * 100}`} y2={`${corners[2].y * 100}`} 
                    stroke="rgba(16, 185, 129, 0.2)" strokeWidth="0.3" strokeDasharray="1 1" 
                  />
                  <line 
                    x1={`${corners[1].x * 100}`} y1={`${corners[1].y * 100}`} 
                    x2={`${corners[3].x * 100}`} y2={`${corners[3].y * 100}`} 
                    stroke="rgba(16, 185, 129, 0.2)" strokeWidth="0.3" strokeDasharray="1 1" 
                  />
                </svg>
                
                {corners.map((p, i) => (
                  <div 
                    key={`corner-${i}`}
                    onMouseDown={() => setIsDragging(i)}
                    onTouchStart={() => setIsDragging(i)}
                    className="absolute w-12 h-12 -ml-6 -mt-6 flex items-center justify-center cursor-pointer z-30"
                    style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                  >
                    <div className="w-8 h-8 bg-emerald-500 rounded-full shadow-xl border-4 border-white flex items-center justify-center">
                      <div className="w-2 h-2 bg-white rounded-full"></div>
                    </div>
                  </div>
                ))}

                {/* Midpoint Handles for Edge Dragging */}
                {getMidPoints().map((p, i) => (
                  <div 
                    key={`mid-${i}`}
                    onMouseDown={() => setIsDragging(i + 4)}
                    onTouchStart={() => setIsDragging(i + 4)}
                    className="absolute w-10 h-10 -ml-5 -mt-5 flex items-center justify-center cursor-pointer z-20"
                    style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                  >
                    <div className="w-6 h-6 bg-emerald-400/80 rounded-full border-2 border-white shadow-md"></div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 'process' && (
            <div className="w-full h-full flex flex-col items-center justify-center bg-white">
              {!processedImage ? (
                <div className="text-center space-y-4">
                  <Loader2 className="animate-spin mx-auto text-[#1a3a3a]" size={48} />
                  <p className="text-[#1a3a3a]/40 text-xs uppercase tracking-widest">Traitement...</p>
                </div>
              ) : (
                <div className="w-full h-full relative overflow-hidden">
                  <motion.div 
                    className="w-full h-full"
                    style={{ rotate: rotation }}
                    transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                  >
                    <img src={processedImage} className="w-full h-full object-contain" alt="Processed" />
                  </motion.div>
                </div>
              )}
            </div>
          )}

          {step === 'sending' && (
            <div className="w-full h-full flex flex-col items-center justify-center bg-[#1a3a3a]">
              <div className="bg-emerald-500/20 p-8 rounded-full inline-block mb-6">
                <Loader2 className="animate-spin text-emerald-500" size={64} />
              </div>
              <div className="text-center">
                <h2 className="text-2xl font-bold text-white mb-2">Transfert...</h2>
                <p className="text-white/40 text-sm uppercase tracking-widest">Envoi au PC</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer / Action Bar */}
        <div className="bg-[#1a3a3a] px-6 py-4 flex justify-between items-center border-t border-white/5">
          {step === 'capture' ? (
            <div className="w-full flex justify-center">
              <p className="text-[10px] text-white/40 uppercase tracking-[0.2em]">Alignez le document</p>
            </div>
          ) : step === 'adjust' ? (
            <>
              <button 
                onClick={() => setStep('capture')}
                className="p-2 text-white/60 hover:text-white transition-colors"
                title="Réinitialiser"
              >
                <RotateCcw size={24} />
              </button>
              <div className="flex gap-6">
                <button onClick={() => setRotation(r => r - 90)} className="p-2 text-white/60 hover:text-white transition-colors">
                  <RotateCcw size={24} className="scale-x-[-1]" />
                </button>
                <button onClick={() => setRotation(r => r + 90)} className="p-2 text-white/60 hover:text-white transition-colors">
                  <RotateCw size={24} />
                </button>
              </div>
              <button 
                onClick={processImage}
                className="p-2 text-emerald-400 hover:text-emerald-300 transition-colors"
                title="Valider"
              >
                <Check size={28} strokeWidth={3} />
              </button>
            </>
          ) : step === 'process' ? (
            <>
              <button 
                onClick={() => setStep('adjust')}
                className="p-2 text-white/60 hover:text-white transition-colors"
              >
                <Maximize size={24} />
              </button>
              <div className="flex gap-6">
                <button onClick={() => setRotation(r => r - 90)} className="p-2 text-white/60 hover:text-white transition-colors">
                  <RotateCcw size={24} className="scale-x-[-1]" />
                </button>
                <button onClick={() => setRotation(r => r + 90)} className="p-2 text-white/60 hover:text-white transition-colors">
                  <RotateCw size={24} />
                </button>
              </div>
              <button 
                onClick={handleFinalSend}
                className="p-2 text-emerald-400 hover:text-emerald-300 transition-colors"
              >
                <Check size={28} strokeWidth={3} />
              </button>
            </>
          ) : null}
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
