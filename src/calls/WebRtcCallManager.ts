import { callPeerClientId, callPeerId, callPeerUsername } from "./callTypes";
import type { CallMediaState, CallSignalPayload, RemoteCallMedia } from "./callTypes";
import { rtcRuntimeConfig, turnServerById, turnServerList } from "@/config/runtime";
import type { TurnServerConfig } from "@/config/runtime";

interface PeerState {
  pc: RTCPeerConnection;
  stream: MediaStream;
  senders: Partial<Record<LocalTrackRole, RTCRtpSender>>;
  makingOffer: boolean;
  ignoreOffer: boolean;
  settingRemoteAnswer: boolean;
  pendingCandidates: RTCIceCandidateInit[];
  signalChain: Promise<void>;
}

type LocalTrackRole = "audio" | "camera" | "screen" | "screenAudio";

interface LocalTrackSlot {
  track: MediaStreamTrack;
  stream: MediaStream;
}

interface WebRtcCallManagerOptions {
  roomId: string;
  username: string;
  clientId?: string;
  platform?: string;
  localStream: MediaStream;
  turnServerId?: string;
  turnServer?: TurnServerConfig;
  sendSignal: (payload: CallSignalPayload) => void;
  onRemoteMedia: (username: string, media: RemoteCallMedia) => void;
  onRemoteLeft: (username: string) => void;
}


function rtcPeerConnectionConstructor() {
  return globalThis.RTCPeerConnection
    || (globalThis as typeof globalThis & { webkitRTCPeerConnection?: typeof RTCPeerConnection }).webkitRTCPeerConnection;
}

export function webRtcSupported() {
  return typeof rtcPeerConnectionConstructor() !== "undefined";
}

function resolveTurnServer(turnServerId?: string) {
  const id = turnServerId?.trim();
  if (id) {
    const found = turnServerById(id);
    if (found) return found;
  }
  // Fall back to the legacy flat config so existing deployments keep working.
  if (
    Array.isArray(rtcRuntimeConfig.turnUrls)
    && rtcRuntimeConfig.turnUrls.length > 0
    && rtcRuntimeConfig.turnUsername
  ) {
    return {
      id: "legacy",
      label: "Serveur TURN",
      hint: "",
      urls: rtcRuntimeConfig.turnUrls,
      username: rtcRuntimeConfig.turnUsername,
      credential: rtcRuntimeConfig.turnCredential || ""
    };
  }
  // Last resort: first server in the list.
  return turnServerList()[0];
}

export function relayCallsConfigured(turnServerId?: string, turnServer?: TurnServerConfig) {
  const server = turnServer || resolveTurnServer(turnServerId);
  if (!server || !Array.isArray(server.urls) || server.urls.length === 0) return false;
  // STUN-only servers don't need credentials.
  const isStunOnly = server.urls.every(u => u.startsWith("stun:"));
  return webRtcSupported()
    && rtcRuntimeConfig.callsEnabled !== false
    && (isStunOnly || (!!server.username && !!server.credential));
}

export function relayCallsRequirementMessage() {
  if (!webRtcSupported()) {
    return "Calls are not available in this runtime because WebRTC is not supported.";
  }

  if (rtcRuntimeConfig.callsEnabled === false) {
    return rtcRuntimeConfig.callsUnavailableReason || "Calls are disabled by runtime configuration.";
  }

  if (turnServerList().length === 0 && (!Array.isArray(rtcRuntimeConfig.turnUrls) || rtcRuntimeConfig.turnUrls.length === 0)) {
    return "Calls are disabled until TURN URLs are configured.";
  }

  if (!rtcRuntimeConfig.turnUsername && turnServerList().every(s => !s.username) && turnServerList().every(s => s.urls.some(u => !u.startsWith("stun:")))) {
    return "Calls are disabled until TURN credentials are configured.";
  }

  return "Calls are available.";
}

function rtcConfig(turnServerId?: string, turnServer?: TurnServerConfig): RTCConfiguration {
  const server = turnServer || resolveTurnServer(turnServerId);
  if (server && server.urls.length > 0) {
    const hasTurn = server.urls.some(u => u.startsWith("turn:") || u.startsWith("turns:"));
    return {
      iceTransportPolicy: hasTurn ? "relay" : "all",
      iceCandidatePoolSize: 1,
      iceServers: [{
        urls: server.urls,
        username: server.username || undefined,
        credential: server.credential || undefined
      }]
    };
  }
  return { iceTransportPolicy: "all", iceServers: [] };
}

export class WebRtcCallManager {
  private readonly peers = new Map<string, PeerState>();
  private readonly roomId: string;
  private readonly username: string;
  private readonly clientId: string;
  private readonly platform: string;
  private readonly turnServerId: string;
  private readonly turnServer?: TurnServerConfig;
  private readonly selfPeerId: string;
  private readonly sendSignal: WebRtcCallManagerOptions["sendSignal"];
  private readonly onRemoteMedia: WebRtcCallManagerOptions["onRemoteMedia"];
  private readonly onRemoteLeft: WebRtcCallManagerOptions["onRemoteLeft"];
  private localStream: MediaStream;
  private readonly localTracks = new Map<LocalTrackRole, LocalTrackSlot>();
  private localMedia: CallMediaState = { audio: true, camera: false, screen: false };

  constructor(options: WebRtcCallManagerOptions) {
    this.roomId = options.roomId;
    this.username = options.username;
    this.clientId = String(options.clientId || "");
    this.platform = String(options.platform || "");
    this.turnServerId = String(options.turnServerId || "");
    this.turnServer = options.turnServer;
    this.selfPeerId = callPeerId(this.username, this.clientId);
    this.localStream = options.localStream;
    this.sendSignal = options.sendSignal;
    this.onRemoteMedia = options.onRemoteMedia;
    this.onRemoteLeft = options.onRemoteLeft;
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) this.localTracks.set("audio", { track: audioTrack, stream: this.localStream });
  }

  connectPeer(peerName: string, clientId = "") {
    const peerId = callPeerId(peerName, clientId);
    if (!peerId || peerId === this.selfPeerId || this.peers.has(peerId)) return;
    this.createPeer(peerId);
  }

  removePeer(peerName: string, clientId = "") {
    const peerId = callPeerId(peerName, clientId);
    if (!peerId) return;
    const peer = this.peers.get(peerId);
    if (!peer) return;
    peer.pc.close();
    for (const track of peer.stream.getTracks()) track.stop();
    this.peers.delete(peerId);
    this.onRemoteLeft(callPeerUsername(peerId));
  }

  setLocalMedia(media: CallMediaState) {
    this.localMedia = { ...media };
  }

  addLocalStream(stream: MediaStream) {
    for (const track of stream.getTracks()) {
      const role: LocalTrackRole = track.kind === "audio"
        ? "audio"
        : this.localTracks.has("camera")
          ? "screen"
          : "camera";
      this.setLocalTrack(role, track, stream);
    }
  }

  addLocalScreenAudioTrack(track: MediaStreamTrack, stream: MediaStream) {
    if (track.kind !== "audio") return;
    this.setLocalTrack("screenAudio", track, stream);
  }

  removeLocalTracks(predicate: (track: MediaStreamTrack) => boolean) {
    for (const [role, slot] of [...this.localTracks.entries()]) {
      if (predicate(slot.track)) this.removeLocalTrack(role);
    }
  }

  setLocalTrack(role: LocalTrackRole, track: MediaStreamTrack, stream = new MediaStream([track])) {
    const previous = this.localTracks.get(role);
    if (previous?.track === track) return;
    if (previous) this.localStream.removeTrack(previous.track);

    this.localTracks.set(role, { track, stream });
    if (stream !== this.localStream && !this.localStream.getTracks().some((item) => item.id === track.id)) {
      this.localStream.addTrack(track);
    }

    for (const peer of this.peers.values()) {
      const sender = peer.senders[role];
      if (sender) {
        sender.replaceTrack(track).catch(() => this.rebuildSender(peer, role, track, stream));
      } else {
        peer.senders[role] = peer.pc.addTrack(track, stream);
      }
    }
  }

  removeLocalTrack(role: LocalTrackRole) {
    const slot = this.localTracks.get(role);
    if (!slot) return;
    this.localTracks.delete(role);
    this.localStream.removeTrack(slot.track);
    for (const peer of this.peers.values()) {
      const sender = peer.senders[role];
      if (!sender) continue;
      try {
        peer.pc.removeTrack(sender);
      } catch {
        /* sender already detached */
      }
      delete peer.senders[role];
    }
  }

  async handleSignal(payload: CallSignalPayload) {
    const from = callPeerId(payload.from || "", payload.fromClientId || "");
    if (!from || from === this.selfPeerId || payload.gameId !== this.roomId) return;
    if (payload.toClientId && payload.toClientId !== this.clientId) return;
    if (payload.to && payload.to !== this.username) return;

    const peer = this.peers.get(from) || this.createPeer(from);
    peer.signalChain = peer.signalChain
      .then(() => this.applySignal(from, peer, payload))
      .catch(() => this.removePeer(from));
    await peer.signalChain;
  }

  private async applySignal(from: string, peer: PeerState, payload: CallSignalPayload) {
    if (this.peers.get(from) !== peer) return;

    const description = payload.sdp
      ? ({ type: payload.type, sdp: payload.sdp } as RTCSessionDescriptionInit)
      : null;

    if (description) {
      const readyForOffer =
        !peer.makingOffer &&
        (peer.pc.signalingState === "stable" || peer.settingRemoteAnswer);
      const offerCollision = description.type === "offer" && !readyForOffer;
      peer.ignoreOffer = !this.isPolite(from) && offerCollision;
      if (peer.ignoreOffer) return;

      peer.settingRemoteAnswer = description.type === "answer";
      try {
        await peer.pc.setRemoteDescription(description);
      } finally {
        peer.settingRemoteAnswer = false;
      }

      await this.flushPendingCandidates(peer);
      if (description.type === "offer") {
        await peer.pc.setLocalDescription();
        this.sendSignal({
          gameId: this.roomId,
          to: callPeerUsername(from),
          from: this.username,
          toClientId: callPeerClientId(from),
          fromClientId: this.clientId,
          fromPlatform: this.platform,
          type: "answer",
          sdp: peer.pc.localDescription?.sdp || ""
        });
      }
    } else if (payload.candidate) {
      if (!peer.pc.remoteDescription) {
        if (peer.ignoreOffer) return;
        peer.pendingCandidates.push(payload.candidate);
        return;
      }
      await this.addIceCandidate(peer, payload.candidate);
    }
  }

  close() {
    for (const peerName of [...this.peers.keys()]) this.removePeer(peerName);
  }

  private createPeer(peerName: string): PeerState {
    const RtcPeerConnection = rtcPeerConnectionConstructor();
    if (!RtcPeerConnection) {
      throw new Error(relayCallsRequirementMessage());
    }

    const pc = new RtcPeerConnection(rtcConfig(this.turnServerId, this.turnServer));
    const stream = new MediaStream();
    const peer: PeerState = {
      pc,
      stream,
      senders: {},
      makingOffer: false,
      ignoreOffer: false,
      settingRemoteAnswer: false,
      pendingCandidates: [],
      signalChain: Promise.resolve()
    };
    this.peers.set(peerName, peer);

    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) {
        console.debug(`[WebRTC] ICE gathering complete for ${callPeerUsername(peerName)}`);
        return;
      }
      console.debug(`[WebRTC] ICE candidate for ${callPeerUsername(peerName)}: type=${candidate.type} address=${candidate.address}:${candidate.port} proto=${candidate.protocol}`);
      this.sendSignal({
        gameId: this.roomId,
        to: callPeerUsername(peerName),
        from: this.username,
        toClientId: callPeerClientId(peerName),
        fromClientId: this.clientId,
        fromPlatform: this.platform,
        type: "ice",
        candidate: candidate.toJSON()
      });
    };

    pc.ontrack = ({ track, streams }) => {
      const source = streams[0];
      if (source) {
        for (const item of source.getTracks()) {
          if (!stream.getTracks().some((existing) => existing.id === item.id)) stream.addTrack(item);
        }
      } else if (!stream.getTracks().some((existing) => existing.id === track.id)) {
        stream.addTrack(track);
      }
      const emitRemoteMedia = () => {
        this.onRemoteMedia(callPeerUsername(peerName), { stream, media: this.inferRemoteMedia(stream) });
      };
      track.onended = () => {
        stream.removeTrack(track);
        emitRemoteMedia();
      };
      track.onmute = emitRemoteMedia;
      track.onunmute = emitRemoteMedia;
      emitRemoteMedia();
    };

    pc.onconnectionstatechange = () => {
      console.debug(`[WebRTC] connection state for ${callPeerUsername(peerName)}: ${pc.connectionState}`);
      if (["closed", "failed"].includes(pc.connectionState)) {
        this.removePeer(peerName);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.debug(`[WebRTC] ICE connection state for ${callPeerUsername(peerName)}: ${pc.iceConnectionState}`);
    };

    pc.onicegatheringstatechange = () => {
      console.debug(`[WebRTC] ICE gathering state for ${callPeerUsername(peerName)}: ${pc.iceGatheringState}`);
    };

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        this.sendSignal({
          gameId: this.roomId,
          to: callPeerUsername(peerName),
          from: this.username,
          toClientId: callPeerClientId(peerName),
          fromClientId: this.clientId,
          fromPlatform: this.platform,
          type: "offer",
          sdp: pc.localDescription?.sdp || ""
        });
      } catch {
        this.removePeer(peerName);
      } finally {
        peer.makingOffer = false;
      }
    };

    for (const [role, slot] of this.localTracks.entries()) {
      peer.senders[role] = pc.addTrack(slot.track, slot.stream);
    }

    return peer;
  }

  private rebuildSender(peer: PeerState, role: LocalTrackRole, track: MediaStreamTrack, stream: MediaStream) {
    const sender = peer.senders[role];
    if (sender) {
      try {
        peer.pc.removeTrack(sender);
      } catch {
        /* sender already detached */
      }
    }
    peer.senders[role] = peer.pc.addTrack(track, stream);
  }

  private async addIceCandidate(peer: PeerState, candidate: RTCIceCandidateInit) {
    try {
      await peer.pc.addIceCandidate(candidate);
    } catch (error) {
      if (!peer.ignoreOffer) throw error;
    }
  }

  private async flushPendingCandidates(peer: PeerState) {
    const candidates = peer.pendingCandidates.splice(0);
    for (const candidate of candidates) {
      await this.addIceCandidate(peer, candidate);
    }
  }

  private isPolite(peerName: string) {
    return this.selfPeerId.localeCompare(peerName) > 0;
  }

  private inferRemoteMedia(stream: MediaStream): CallMediaState {
    const hasLiveVideo = stream.getVideoTracks().some((track) => track.readyState === "live" && !track.muted);
    return {
      audio: stream.getAudioTracks().some((track) => track.readyState === "live" && !track.muted),
      // WebRTC track events do not carry our app-level role (camera vs screen).
      // Treat bare video arrival as camera so late joiners render an already-active camera
      // even before/without a fresh call-state broadcast. Screen state is still provided by op 110.
      camera: hasLiveVideo,
      screen: false
    };
  }
}
