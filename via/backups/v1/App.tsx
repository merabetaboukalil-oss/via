import React, { useEffect, useState } from 'react';
import PCView from './components/PCView';
import MobileView from './components/MobileView';

export default function App() {
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const session = params.get('session');
    if (session) {
      setSessionId(session);
    }
  }, []);

  if (sessionId) {
    return <MobileView sessionId={sessionId} />;
  }

  return <PCView />;
}
