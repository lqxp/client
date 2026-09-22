/**
 * Domain types for the messenger state.
 *
 * These describe what the composable already stores at runtime; nothing here
 * changes behaviour. Shapes produced by a normaliser in useMessenger.ts are
 * deliberately left to `ReturnType<typeof …>` there rather than restated, so
 * the two cannot drift apart.
 */

/** A message being answered, as the composer needs it. */
export interface ReplyTarget {
  messageId: string;
  roomId: string;
  username: string;
  text: string;
}

/** A message being edited in place. */
export interface EditingDraft {
  messageId: string;
  roomId: string;
  text: string;
}

export type TimerHandle = ReturnType<typeof setTimeout>;
export type IntervalHandle = ReturnType<typeof setInterval>;

/** Keyed by room id. */
export type ByRoom<T> = Record<string, T>;

/** Keyed by the lower-cased username, or by account id where noted. */
export type ByUser<T> = Record<string, T>;

/** The audio graph kept alive for the duration of a call. */
export interface CallAudioGraph {
  context: AudioContext;
  analyser: AnalyserNode;
  outAnalyser: AnalyserNode;
  gate: GainNode;
  monitorStream: MediaStream;
}

/**
 * A room as the sidebar keeps it. Built in exactly two places in
 * useMessenger.ts, both with these seven fields.
 */
export interface RoomSummary {
  roomId: string;
  title: string;
  lastPreview: string;
  lastTimestamp: number;
  lastSender: string;
  iconUrl: string;
  members: string[];
}

/**
 * A chat message as it arrives from the server, before normalisation.
 *
 * Transcribed from `ChatMessageRecord` in the backend's core/models.rs, which
 * serialises with `rename_all = "camelCase"`; every field carrying
 * `skip_serializing_if` can be absent, so nothing here is required. The last
 * few are added by the client itself and read back by the normaliser.
 */
export interface IncomingMessage {
  messageId?: string;
  threadRootId?: string;
  pollState?: { total?: number; voted?: boolean; counts?: number[] };
  roomId?: string;
  user?: string;
  username?: string;
  userId?: string;
  text?: string;
  timestamp?: number;
  profile?: unknown;
  editedAt?: number;
  system?: boolean;
  reactions?: { emoji: string; users: string[]; count: number }[];
  replyToMessageId?: string;
  attachment?: {
    id?: string;
    url?: string;
    filename?: string;
    mimeType?: string;
    size?: number;
    /** Client-side only: an inline copy kept before upload. */
    dataB64?: string;
  } | null;
  encrypted?: {
    v?: number;
    alg?: string;
    iv?: string;
    salt?: string;
    n?: number;
    senderDeviceId?: string;
    senderSigningKey?: unknown;
    signature?: string;
    ciphertext?: string;
    roomId?: string;
  } | null;
  preview?: {
    url?: string;
    title?: string;
    description?: string;
    image?: string;
    siteName?: string;
  } | null;
  deleted?: boolean;
  deletedBy?: string;
  deletedByModerator?: boolean;
  /** Added by the client, not part of the record on the wire. */
  clientNonce?: string;
  systemKind?: string;
  locked?: boolean;
  mentioned?: boolean;
}

/**
 * Moderator permissions as the server sends them.
 *
 * Transcribed from `ModeratorPermissions` in the backend's core/models.rs,
 * where each field carries `default = "default_true"`, hence all optional.
 */
export interface IncomingModPermissions {
  canBan?: boolean;
  canKick?: boolean;
  canMute?: boolean;
  canDelete?: boolean;
}

/**
 * Room metadata as the server sends it, from `RoomRecord` in core/models.rs.
 * Every field there is defaulted or skippable, so none is required here.
 */
export interface IncomingRoomMeta {
  roomId?: string;
  title?: string;
  kind?: string;
  description?: string;
  ownerId?: string;
  chatLocked?: boolean;
  members?: string[];
  roles?: Record<string, string>;
  banned?: Record<string, string>;
  timeouts?: Record<string, number>;
  modPermissions?: IncomingModPermissions;
  callsEnabled?: boolean;
}

/**
 * One frame off the websocket.
 *
 * The backend declares `SocketPayload { op: u16, d: serde_json::Value }`, and
 * `d` carries a different shape for each of the 47 opcodes. Rather than assert
 * 47 shapes the client cannot verify, `d` is typed as what it actually is:
 * untrusted JSON. Every read therefore has to be coerced or checked, which is
 * what the handler already does almost everywhere.
 */
export interface SocketFrame {
  op?: number;
  d?: Record<string, unknown>;
}

/**
 * The admin overview response.
 *
 * Transcribed from `admin_overview` in the backend's services/admin.rs, which
 * builds the payload with `json!`, so the field names come straight from
 * there. Nothing is required: the panel has to survive an older server.
 */
export interface AdminOverview {
  ok?: boolean;
  generatedAt?: number;
  accounts?: {
    total?: number;
    disabled?: number;
    banned?: number;
    newLastDay?: number;
    newLastWeek?: number;
  };
  connections?: {
    sessions?: number;
    users?: number;
    voice?: number;
    platforms?: { platform?: string; count?: number }[];
  };
  roomTotals?: { known?: number; active?: number; bufferedMessages?: number; voice?: number };
  server?: { version?: string; uptimeMs?: number };
  runtime?: {
    messagesRelayed?: number;
    sessionsOpened?: number;
    peakSessions?: number;
    sinceMs?: number;
  };
  signupsPerDay?: { day?: number; count?: number }[];
  features?: Record<string, boolean>;
  defaultRoom?: { roomId?: string; title?: string } | null;
  rooms?: {
    roomId?: string;
    messageCount?: number;
    lastMessageAt?: number;
    onlineCount?: number;
    voiceCount?: number;
    active?: boolean;
  }[];
}

/** The voice recorder's live state, held while a recording is in progress. */
export interface ActiveRecording {
  recorder: MediaRecorder;
  stream: MediaStream;
  roomId: string;
  chunks: Blob[];
  startedAt: number;
  mimeType: string;
  /** False when the call's own microphone stream is being reused. */
  ownsStream: boolean;
  audioCtx: AudioContext | null;
  waveInterval: ReturnType<typeof setInterval> | null;
  rawWaveSamples: number[];
}

/**
 * A message the sidebar can summarise, in either shape.
 *
 * The preview helpers are handed both a normalised message and one straight
 * off the wire, so they see the wire fields plus the few the normaliser adds.
 */
export type PreviewMessage = IncomingMessage & {
  kind?: string;
  rawText?: string;
  voiceDuration?: string | number;
  jumboEmoji?: boolean;
};

/**
 * An account as the admin endpoints return it.
 *
 * Transcribed from `PublicUser` in the backend's core/database.rs, which
 * serialises with `rename_all = "camelCase"`.
 */
export interface AdminUser {
  id: string;
  username: string;
  profile?: unknown;
  status?: string;
  disabled?: boolean;
  banned?: boolean;
  admin?: boolean;
  badges?: string[];
  /** Only the account itself and admins receive this. */
  customBadges?: string[];
  createdAt?: number;
}

/** One room row of the admin overview. */
export type AdminRoom = NonNullable<AdminOverview["rooms"]>[number] & { title?: string };
