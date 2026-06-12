import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Video, Mic, MicOff, VideoOff, Minimize2, X, PhoneCall, MessageSquare, MonitorPlay, MonitorX } from 'lucide-react';
import { useWebRTC } from '../../hooks/useWebRTC';
import { useDaw } from '../../context/DawContext';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import type { RemoteInputEvent } from '../../types/remote';
import './FloatingVideoChat.css';

interface FloatingVideoChatProps {
  userRole: 'artist' | 'engineer';
  userId: string;
  roomCode: string;
  onInputEvent?: (event: RemoteInputEvent) => void;
  /** active, sendFn, remoteScreenStream */
  onRcStateChange?: (active: boolean, sendFn: ((e: RemoteInputEvent) => void) | null, screenStream: MediaStream | null) => void;
}

const FloatingVideoChat: React.FC<FloatingVideoChatProps> = ({
  userRole, userId, roomCode, onInputEvent, onRcStateChange,
}) => {
  const [isMinimized, setIsMinimized] = useState(true);
  const [showChat, setShowChat] = useState(false);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [monitorVolume, setMonitorVolume] = useState(0.7); // Engineer monitor gain (0–1)
  const [rcDenied, setRcDenied] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; initialX: number; initialY: number } | null>(null);

  const { masterStreamRef, audioCtxRef } = useDaw();
  const { initAudioCtx } = useAudioEngine();

  // AudioContext GainNode for the Engineer's monitor level — lets them
  // control how loud the Artist's DAW output is in their headphones without
  // touching the actual recorded signal level.
  const monitorGainRef = useRef<GainNode | null>(null);
  const monitorSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const {
    localStream, remoteStream, remoteDawStream, remoteScreenStream, isConnected, callActive,
    isMicOn, isVideoOn,
    incomingCall, isCalling, callerId, messages,
    ring, acceptCall, declineCall, sendMessage,
    endCall, toggleMic, toggleVideo,
    rcRequested, rcActive,
    requestRemoteControl, startScreenShare, stopRemoteControl,
    sendInputEvent,
  } = useWebRTC({
    roomCode,
    userId,
    isInitiator: userRole === 'engineer',
    getDawStream: () => {
      if (userRole === 'artist') {
        initAudioCtx();
        return masterStreamRef.current?.stream ?? null;
      }
      return null;
    },
    onInputEvent,
  });

  const localVideoRef   = useRef<HTMLVideoElement>(null);
  const remoteVideoRef  = useRef<HTMLVideoElement>(null);
  const chatScrollRef   = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (localVideoRef.current && localStream) localVideoRef.current.srcObject = localStream;
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) remoteVideoRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  // Engineer: route Artist's DAW stream through an AudioContext GainNode
  // so the Monitor knob controls their listening level without touching the signal.
  useEffect(() => {
    if (userRole !== 'engineer' || !remoteDawStream) return;

    // Lazily spin up / reuse AudioContext
    let ctx = audioCtxRef.current;
    if (!ctx || ctx.state === 'closed') {
      ctx = new AudioContext();
      audioCtxRef.current = ctx;
    }
    const resume = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();

    let gainNode: GainNode;
    let source: MediaStreamAudioSourceNode;

    resume.then(() => {
      if (!ctx) return;
      // Disconnect any previous monitor chain
      monitorSourceRef.current?.disconnect();
      monitorGainRef.current?.disconnect();

      source = ctx.createMediaStreamSource(remoteDawStream);
      gainNode = ctx.createGain();
      gainNode.gain.value = monitorVolume;
      source.connect(gainNode);
      gainNode.connect(ctx.destination);

      monitorSourceRef.current = source;
      monitorGainRef.current = gainNode;
    });

    return () => {
      source?.disconnect();
      gainNode?.disconnect();
      monitorSourceRef.current = null;
      monitorGainRef.current = null;
    };
  // remoteDawStream identity change triggers reconnect; monitorVolume does NOT re-create the chain
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteDawStream, userRole, audioCtxRef]);

  // Live-update gain without recreating the audio graph
  useEffect(() => {
    if (monitorGainRef.current) {
      monitorGainRef.current.gain.setTargetAtTime(monitorVolume, 0, 0.02);
    }
  }, [monitorVolume]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, showChat]);

  // Reset deny flag when engineer withdraws the request (so next request shows banner again)
  useEffect(() => {
    if (!rcRequested) setRcDenied(false);
  }, [rcRequested]);

  // Notify parent when RC state changes so it can show overlay and wire sendInputEvent
  useEffect(() => {
    onRcStateChange?.(rcActive, rcActive ? sendInputEvent : null, rcActive ? remoteScreenStream : null);
  }, [rcActive, sendInputEvent, onRcStateChange, remoteScreenStream]);

  // Artist: auto-prompt screen share when Engineer requests RC
  // (no silent auto-accept — the consent banner below handles this)

  // ── Drag Handlers ──────────────────────────────────────────────────
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const rect = e.currentTarget.parentElement!.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      initialX: position ? position.x : rect.left,
      initialY: position ? position.y : rect.top,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    setPosition({
      x: dragRef.current.initialX + (e.clientX - dragRef.current.startX),
      y: dragRef.current.initialY + (e.clientY - dragRef.current.startY),
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  // ── Minimized pill — portalled into the transport bar ────────────
  if (isMinimized) {
    const slot = document.getElementById('transport-chat-slot');
    if (!slot) return null;
    const pillStatus = incomingCall ? 'ringing' : callActive && isConnected ? 'connected' : callActive ? 'connecting' : 'idle';
    return createPortal(
      <div className={`transport-chat-pill pill-${pillStatus}`} onClick={() => setIsMinimized(false)} title="Open Video Chat">
        <div className="pill-video-icon">
          <Video size={14} />
        </div>
        <div className={`live-dot-small ${pillStatus === 'connected' ? 'connected' : pillStatus === 'ringing' ? 'ringing' : ''}`} />
        <span className="transport-chat-label">
          {incomingCall ? 'Incoming Call' : rcActive ? 'Remote Control' : callActive ? (isConnected ? 'In Call' : 'Connecting…') : 'Video Call'}
        </span>
      </div>,
      slot,
    );
  }

  return (
    <div
      className="floating-video-widget"
      style={position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto', margin: 0 } : undefined}
    >
      {/* remoteDawStream is now routed through AudioContext GainNode above — no raw <audio> element needed */}

      <div
        className="widget-header"
        style={{ cursor: 'move', userSelect: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div className="widget-title">
          <div className={`live-dot ${rcActive ? 'rc' : callActive && isConnected ? 'connected' : ''}`} />
          <span>
            {rcActive ? 'Remote Control' : isCalling ? 'Calling...' : callActive ? (isConnected ? 'Live Session' : 'Connecting…') : 'Video Chat'}
          </span>
        </div>
        <div className="widget-controls">
          <button className="icon-btn" onClick={() => setIsMinimized(true)} title="Minimise to bar">
            <Minimize2 size={14} />
          </button>
        </div>
      </div>

      {/* Artist: RC consent banner */}
      {rcRequested && !rcDenied && userRole === 'artist' && (
        <div className="rc-consent-banner">
          <span className="rc-consent-text">Engineer is requesting remote control</span>
          <div className="rc-consent-actions">
            <button className="rc-consent-btn decline" onClick={() => setRcDenied(true)}>Deny</button>
            <button className="rc-consent-btn accept" onClick={() => { setRcDenied(false); startScreenShare(); }}>Allow</button>
          </div>
        </div>
      )}

      {incomingCall ? (
        <div className="incoming-call-screen">
          <div className="incoming-call-avatar">{callerId?.[0]?.toUpperCase() || '?'}</div>
          <div className="incoming-call-text">Incoming Call...</div>
          <div className="incoming-call-actions">
            <button className="control-btn end-call" onClick={declineCall} title="Decline"><X size={18} /></button>
            <button className="control-btn start-call" onClick={acceptCall} title="Accept"><PhoneCall size={18} /></button>
          </div>
        </div>
      ) : (
        <div className="video-grid">
          <div className="video-feed remote">
            {remoteStream ? (
              <video ref={remoteVideoRef} autoPlay playsInline className="video-el" />
            ) : (
              <div className="video-placeholder">
                {isCalling ? 'Ringing...' : callActive ? 'Connecting...' : userRole === 'artist' ? 'Engineer Cam' : 'Artist Cam'}
              </div>
            )}
            <div className="feed-name">{userRole === 'engineer' ? 'Artist' : 'Engineer'}</div>
          </div>

          {callActive && (
            <div className="video-feed local">
              {localStream ? (
                <video ref={localVideoRef} autoPlay playsInline muted className="video-el" />
              ) : (
                <div className="video-placeholder">Your Cam</div>
              )}
              <div className="feed-name">You</div>
            </div>
          )}
        </div>
      )}

      {showChat && (
        <div className="chat-pane">
          <div className="chat-messages" ref={chatScrollRef}>
            {messages.length === 0 && <div className="chat-empty">No messages yet.</div>}
            {messages.map(m => (
              <div key={m.id} className={`chat-message ${m.sender === userId ? 'self' : 'other'}`}>
                <span className="msg-text">{m.text}</span>
              </div>
            ))}
          </div>
          <div className="chat-input-row">
            <input
              type="text"
              className="chat-input"
              placeholder="Type a message..."
              onKeyDown={e => {
                if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                  sendMessage(e.currentTarget.value.trim());
                  e.currentTarget.value = '';
                }
              }}
            />
          </div>
        </div>
      )}

      <div className="widget-footer">
        <div className="call-controls">
          {callActive ? (
            <>
              <button className={`control-btn ${!isMicOn ? 'off' : ''}`} onClick={toggleMic} title={isMicOn ? 'Mute mic' : 'Unmute mic'}>
                {isMicOn ? <Mic size={18} /> : <MicOff size={18} />}
              </button>
              <button className={`control-btn ${!isVideoOn ? 'off' : ''}`} onClick={toggleVideo} title={isVideoOn ? 'Turn off camera' : 'Turn on camera'}>
                {isVideoOn ? <Video size={18} /> : <VideoOff size={18} />}
              </button>
              {/* Engineer: Remote Control toggle */}
              {userRole === 'engineer' && isConnected && (
                <button
                  className={`control-btn rc-btn ${rcActive ? 'active' : ''}`}
                  onClick={rcActive ? stopRemoteControl : requestRemoteControl}
                  title={rcActive ? 'Stop remote control' : 'Request remote control'}
                >
                  {rcActive ? <MonitorX size={18} /> : <MonitorPlay size={18} />}
                </button>
              )}
              <button className="control-btn end-call" onClick={endCall} title="End call">
                <X size={18} />
              </button>
            </>
          ) : !incomingCall && (
            <button className={`control-btn start-call ${isCalling ? 'calling' : ''}`} onClick={isCalling ? endCall : ring} title={isCalling ? 'Cancel Call' : 'Call'}>
              {isCalling ? <X size={18} /> : <PhoneCall size={18} />}
              <span style={{ marginLeft: 6, fontSize: 12 }}>{isCalling ? 'Cancel' : 'Call'}</span>
            </button>
          )}
        </div>

        {/* Engineer Monitor Level knob — controls local listening volume only */}
        {userRole === 'engineer' && remoteDawStream && (
          <div className="monitor-knob-row">
            <span className="monitor-knob-label">Monitor</span>
            <input
              id="monitor-level-knob"
              type="range"
              className="monitor-knob-slider"
              min={0} max={1} step={0.01}
              value={monitorVolume}
              onChange={e => setMonitorVolume(parseFloat(e.target.value))}
              title={`Monitor level: ${Math.round(monitorVolume * 100)}%`}
            />
            <span className="monitor-knob-value">{Math.round(monitorVolume * 100)}%</span>
          </div>
        )}

        <div className="widget-extra-controls">
          <button className={`chat-toggle-btn ${showChat ? 'active' : ''}`} onClick={() => setShowChat(!showChat)} title="Toggle Chat">
            <MessageSquare size={16} color={showChat ? '#000' : '#fff'} />
            {!showChat && messages.length > 0 && <div className="chat-badge" />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default FloatingVideoChat;
