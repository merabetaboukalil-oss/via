import React, { useEffect, useState } from 'react';
import PCView from './components/PCView';
import MobileView from './components/MobileView';
import DashboardView from './components/DashboardView';

export default function App() {
  const [pairId, setPairId] = useState<string | null>(null);
  const [isDashboard, setIsDashboard] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pair = params.get('pair');
    if (pair) {
      setPairId(pair);
    }

    if (window.location.pathname === '/dashboard') {
      setIsDashboard(true);
    }
  }, []);

  if (isDashboard) {
    return <DashboardView onGoHome={() => setIsDashboard(false)} />;
  }

  if (pairId) {
    return <MobileView pairId={pairId} />;
  }

  return <PCView onNavigateToDashboard={() => setIsDashboard(true)} />;
}
