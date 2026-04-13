
export async function stopAllCameraTracks() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const hasCamera = devices.some(device => device.kind === 'videoinput');
    
    if (hasCamera) {
      // This is a bit aggressive but ensures we try to kill everything
      const streams = await navigator.mediaDevices.getUserMedia({ video: true }).catch(() => null);
      if (streams) {
        streams.getTracks().forEach(track => track.stop());
      }
    }
    
    // Also try to find any active streams if possible (browser dependent)
    // Most browsers don't expose all active streams, but we can try to stop tracks on the current window
    if (typeof window !== 'undefined') {
      // Some browsers might have these
    }
  } catch (err) {
    console.error("Error stopping all camera tracks:", err);
  }
}
