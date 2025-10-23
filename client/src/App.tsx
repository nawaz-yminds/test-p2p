import { useEffect, useMemo, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'
import './App.css'

type Nullable<T> = T | null

const genId = (len = 8) => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  const arr = new Uint32Array(len)
  if (crypto?.getRandomValues) crypto.getRandomValues(arr)
  for (let i = 0; i < len; i++) {
    const n = arr[i] || Math.floor(Math.random() * alphabet.length)
    out += alphabet[n % alphabet.length]
  }
  return out
}

const getSocketUrl = () => {
  const env = import.meta.env?.VITE_SOCKET_URL as string | undefined
  return env && String(env).trim().length > 0 ? env : window.location.origin
}

function App() {
  const url = new URL(window.location.href)
  const qpRoom = url.searchParams.get('room') || ''
  const isJoiner = !!qpRoom
  const [roomId] = useState<string>(qpRoom || genId())
  const shareUrl = useMemo(() => {
    const u = new URL(window.location.href)
    u.searchParams.set('room', roomId)
    return u.toString()
  }, [roomId])

  const [status, setStatus] = useState<string>('idle')
  const [error, setError] = useState<string>('')
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const pcRef = useRef<Nullable<RTCPeerConnection>>(null)
  const socketRef = useRef<Nullable<Socket>>(null)
  const localStreamRef = useRef<Nullable<MediaStream>>(null)

  const createPeerConnection = () => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    })
    pc.onicecandidate = (e) => {
      if (e.candidate && socketRef.current) {
        socketRef.current.emit('candidate', { roomId, candidate: e.candidate })
      }
    }
    pc.ontrack = (e) => {
      const [stream] = e.streams
      if (remoteVideoRef.current && stream) {
        remoteVideoRef.current.srcObject = stream
      }
    }
    pcRef.current = pc
    return pc
  }

  const ensureSocket = () => {
    if (socketRef.current) return socketRef.current
    const socket = io(getSocketUrl(), { transports: ['websocket'] })
    socketRef.current = socket
    return socket
  }

  const stopAll = () => {
    try {
      socketRef.current?.emit('leave')
      socketRef.current?.disconnect()
    } catch {}
    socketRef.current = null
    try {
      pcRef.current?.getSenders().forEach((s) => s.track && s.track.stop())
      pcRef.current?.close()
    } catch {}
    pcRef.current = null
    localStreamRef.current?.getTracks().forEach((t) => t.stop())
    localStreamRef.current = null
    if (localVideoRef.current) localVideoRef.current.srcObject = null
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null
    setStatus('idle')
    setError('')
  }

  useEffect(() => {
    const onUnload = () => stopAll()
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [])

  const startHost = async () => {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      localStreamRef.current = stream
      if (localVideoRef.current) localVideoRef.current.srcObject = stream
      const pc = createPeerConnection()
      stream.getTracks().forEach((t) => pc.addTrack(t, stream))
      const socket = ensureSocket()
      socket.on('answer', async (sdp: RTCSessionDescriptionInit) => {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp))
      })
      socket.on('candidate', async (c: RTCIceCandidateInit) => {
        try { await pc.addIceCandidate(new RTCIceCandidate(c)) } catch {}
      })
      socket.on('leave', () => {
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null
      })
      socket.on('room-full', () => setError('Room is full'))
      socket.on('peer-joined', async () => {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        socket.emit('offer', { roomId, sdp: offer })
      })
      socket.emit('join-room', roomId)
      setStatus('hosting')
    } catch (e: any) {
      setError(e?.message || 'Failed to start webcam')
    }
  }

  const startJoiner = async (offer: RTCSessionDescriptionInit) => {
    setError('')
    try {
      const pc = createPeerConnection()
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      })
      localStreamRef.current = stream
      if (localVideoRef.current) localVideoRef.current.srcObject = stream
      stream.getTracks().forEach((t) => pc.addTrack(t, stream))

      const socket = ensureSocket()
      socket.on('candidate', async (c: RTCIceCandidateInit) => {
        try { await pc.addIceCandidate(new RTCIceCandidate(c)) } catch {}
      })
      socket.on('leave', () => {
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null
      })

      await pc.setRemoteDescription(new RTCSessionDescription(offer))
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      socket.emit('answer', { roomId, sdp: answer })
      setStatus('joined')
    } catch (e: any) {
      setError(e?.message || 'Failed to start mobile camera')
    }
  }

  useEffect(() => {
    if (!isJoiner) return
    const socket = ensureSocket()
    socket.on('offer', async (sdp: RTCSessionDescriptionInit) => {
      await startJoiner(sdp)
    })
    socket.on('room-full', () => setError('Room is full'))
    socket.emit('join-room', roomId)
    setStatus('waiting-offer')
    return () => {
      socket.off('offer')
      socket.off('room-full')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isJoiner, roomId])

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
    } catch {}
  }

  return (
    <div className="container">
      <h2>WebRTC P2P Webcam</h2>
      <div className="actions">
        {!isJoiner && (
          <>
            <button onClick={startHost} disabled={status !== 'idle'}>Start Webcam</button>
            <input className="link" value={shareUrl} readOnly />
            <button onClick={copyLink}>Copy Link</button>
          </>
        )}
        {isJoiner && <span>Room: {roomId}</span>}
        <button onClick={stopAll}>Stop</button>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="videos">
        <div className="pane">
          <div className="label">Left: This device</div>
          <video ref={localVideoRef} autoPlay muted playsInline />
        </div>
        <div className="pane">
          <div className="label">Right: Remote device</div>
          <video ref={remoteVideoRef} autoPlay playsInline />
        </div>
      </div>
      <div className="status">Status: {status}</div>
    </div>
  )
}

export default App
