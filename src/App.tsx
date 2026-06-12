import { useState, useEffect } from 'react';
import './index.css';

import { supabase } from './lib/supabaseClient';
import { DawProvider } from './context/DawContext';
import DawWorkspace from './components/daw/DawWorkspace';
import AuthScreen from './components/auth/AuthScreen';
import SessionScreen from './components/session/SessionScreen';
import LandingPage from './components/landing/LandingPage';

function App() {
  const [showApp, setShowApp] = useState(() =>
    localStorage.getItem('sl_showApp') === 'true'
  );
  const [userRole, setUserRole] = useState<'artist' | 'engineer' | null>(() =>
    (localStorage.getItem('sl_role') as 'artist' | 'engineer') || null
  );
  const [session, setSession] = useState<any>(null);
  const [roomCode, setRoomCode] = useState<string | null>(() =>
    localStorage.getItem('sl_room')
  );

  // On mount: re-validate Supabase session (handles page refresh and app restart)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setSession(data.session);
      } else {
        // Token expired — clear persisted state and drop back to auth
        localStorage.removeItem('sl_role');
        localStorage.removeItem('sl_room');
        setUserRole(null);
        setRoomCode(null);
      }
    });
  }, []);

  const handleLogin = (role: 'artist' | 'engineer', activeSession: any) => {
    setUserRole(role);
    setSession(activeSession);
    localStorage.setItem('sl_role', role);
  };

  const handleJoinSession = (code: string) => {
    setRoomCode(code);
    localStorage.setItem('sl_room', code);
  };

  const handleLaunchWeb = () => {
    setShowApp(true);
    localStorage.setItem('sl_showApp', 'true');
  };

  if (!showApp) {
    return (
      <LandingPage
        onLaunchWeb={handleLaunchWeb}
        exeDownloadUrl="https://github.com/shantileemedia-developer/studiodesk/releases/download/v0.0.0/StudioDESK-Setup-0.0.0.exe"
      />
    );
  }

  if (!session || !userRole) {
    return (
      <div className="app-container">
        <div className="top-bar">
          <div className="top-bar-title">StudioDESK</div>
        </div>
        <AuthScreen onLogin={handleLogin} />
      </div>
    );
  }

  if (!roomCode) {
    return (
      <div className="app-container">
        <div className="top-bar">
          <div className="top-bar-title">StudioDESK — {userRole === 'engineer' ? 'Engineer' : 'Artist'}</div>
        </div>
        <SessionScreen userRole={userRole} onJoin={handleJoinSession} />
      </div>
    );
  }

  return (
    <DawProvider userRole={userRole}>
      <div className="app-container daw-mode">
        <DawWorkspace
          userRole={userRole}
          userId={session.user.id}
          roomCode={roomCode}
        />
      </div>
    </DawProvider>
  );
}

export default App;
