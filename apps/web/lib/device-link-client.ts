"use client";

import {
  applyBackupPayload,
  chunkBackupPayload,
  collectBackupPayload,
  createChunkReassembler,
  type ChunkMessage,
  type ImportTimelineEntriesResult,
} from "@driftline/backup";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";

import { startDeviceLink } from "./api-client";
import { useAuth } from "./auth-context";
import { useLocalStore } from "./local-store-context";
import { useSyncEngine } from "./sync-context";

// A single public STUN server, free — ADR-0003's plan for P2P transfer without a paid TURN
// service. If a data channel can't establish (e.g. symmetric NAT on both sides), both hooks below
// time out and report failure so the UI can fall back to backup export/import
// (docs/ADR/0008-device-linking-protocol.md).
const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
const NO_SIGNAL_TIMEOUT_MS = 18_000;
const DATA_CHANNEL_LABEL = "driftline-device-link";
const BUFFERED_AMOUNT_LOW_THRESHOLD = 64 * 1024;
const FALLBACK_MESSAGE = "Couldn't connect to the other device — try exporting a backup file instead.";

type RtcSignal =
  | { kind: "offer"; sdp: RTCSessionDescriptionInit }
  | { kind: "answer"; sdp: RTCSessionDescriptionInit }
  | { kind: "ice"; candidate: RTCIceCandidateInit };

// Wraps one side of a device-linking WebRTC handshake: offer/answer/ICE exchange over the existing
// device-link:signal relay, with early-ICE-candidate buffering (a candidate can arrive before the
// corresponding setRemoteDescription resolves) and a reset-on-every-signal stall timeout.
class PeerLink {
  private readonly pc: RTCPeerConnection;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private remoteDescriptionSet = false;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly socket: Socket,
    private readonly code: string,
    private readonly peerDeviceId: string,
    private readonly onTimeout: () => void,
  ) {
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal({ kind: "ice", candidate: event.candidate.toJSON() });
      }
    };
    this.resetTimeout();
  }

  get connection(): RTCPeerConnection {
    return this.pc;
  }

  private resetTimeout(): void {
    if (this.timeoutHandle) clearTimeout(this.timeoutHandle);
    this.timeoutHandle = setTimeout(this.onTimeout, NO_SIGNAL_TIMEOUT_MS);
  }

  private sendSignal(signal: RtcSignal): void {
    this.socket.emit("device-link:signal", { code: this.code, targetDeviceId: this.peerDeviceId, signal });
  }

  async createOffer(): Promise<RTCDataChannel> {
    const channel = this.pc.createDataChannel(DATA_CHANNEL_LABEL);
    channel.bufferedAmountLowThreshold = BUFFERED_AMOUNT_LOW_THRESHOLD;
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.sendSignal({ kind: "offer", sdp: offer });
    return channel;
  }

  async handleSignal(signal: RtcSignal): Promise<void> {
    this.resetTimeout();

    if (signal.kind === "offer") {
      await this.pc.setRemoteDescription(signal.sdp);
      this.remoteDescriptionSet = true;
      await this.flushPendingCandidates();
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.sendSignal({ kind: "answer", sdp: answer });
    } else if (signal.kind === "answer") {
      await this.pc.setRemoteDescription(signal.sdp);
      this.remoteDescriptionSet = true;
      await this.flushPendingCandidates();
    } else if (this.remoteDescriptionSet) {
      await this.pc.addIceCandidate(signal.candidate);
    } else {
      this.pendingCandidates.push(signal.candidate);
    }
  }

  private async flushPendingCandidates(): Promise<void> {
    const candidates = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const candidate of candidates) {
      await this.pc.addIceCandidate(candidate);
    }
  }

  close(): void {
    if (this.timeoutHandle) clearTimeout(this.timeoutHandle);
    this.pc.close();
  }
}

async function sendChunked(channel: RTCDataChannel, messages: ChunkMessage[], onProgress: (sent: number, total: number) => void): Promise<void> {
  const totalItems = messages[0]?.type === "start" ? messages[0].totalItems : 0;
  let sent = 0;
  for (const message of messages) {
    if (channel.bufferedAmount > BUFFERED_AMOUNT_LOW_THRESHOLD) {
      await new Promise<void>((resolve) => {
        channel.onbufferedamountlow = () => resolve();
      });
    }
    channel.send(JSON.stringify(message));
    if (message.type === "chunk") {
      sent += message.items.length;
      onProgress(sent, totalItems);
    }
  }
}

// ---- Host: the new/empty device, showing the QR/code and waiting for a source to join ----

export type DeviceLinkHostState =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "waiting"; code: string; expiresAt: string }
  | { phase: "connecting" }
  | { phase: "transferring"; receivedCount: number; totalItems: number | undefined }
  | { phase: "done"; result: ImportTimelineEntriesResult }
  | { phase: "failed"; message: string };

export interface UseDeviceLinkHostResult {
  state: DeviceLinkHostState;
  start: () => Promise<void>;
  cancel: () => void;
}

export function useDeviceLinkHost(): UseDeviceLinkHostResult {
  const { authedCall } = useAuth();
  const { db } = useLocalStore();
  const { socket } = useSyncEngine();
  const [state, setState] = useState<DeviceLinkHostState>({ phase: "idle" });
  const linkRef = useRef<PeerLink | null>(null);
  const codeRef = useRef<string | null>(null);

  const cancel = useCallback(() => {
    if (socket && codeRef.current) socket.emit("device-link:cancel", { code: codeRef.current });
    linkRef.current?.close();
    linkRef.current = null;
    codeRef.current = null;
    setState({ phase: "idle" });
  }, [socket]);

  // Deliberately doesn't gate on `socket` being ready — minting a code is a plain REST call, and
  // the peer-joined listener below re-subscribes whenever `socket` changes, so it's already
  // wired up correctly by the time a source device actually joins. Gating here on the socket's
  // connect handshake completing first was a real bug: a user who opens this page and clicks
  // immediately (a very normal thing to do) would silently get nothing at all.
  const start = useCallback(async () => {
    setState({ phase: "starting" });
    try {
      const { code, expiresAt } = await authedCall((token) => startDeviceLink(token));
      codeRef.current = code;
      setState({ phase: "waiting", code, expiresAt });
    } catch {
      setState({ phase: "failed", message: "Couldn't start device linking — try again." });
    }
  }, [authedCall]);

  useEffect(() => {
    if (!socket || !db) return undefined;
    // Named function declarations below don't inherit the narrowing above (TS can't prove they
    // aren't invoked before this line runs) — local aliases carry the non-null types through.
    const activeSocket = socket;
    const activeDb = db;

    function fail(message: string) {
      linkRef.current?.close();
      linkRef.current = null;
      setState({ phase: "failed", message });
    }

    function handlePeerJoined(payload: unknown) {
      const { sourceDeviceId } = payload as { sourceDeviceId: string };
      const code = codeRef.current;
      if (!code) return;
      setState({ phase: "connecting" });

      const link = new PeerLink(activeSocket, code, sourceDeviceId, () => fail(FALLBACK_MESSAGE));
      linkRef.current = link;
      const reassembler = createChunkReassembler();

      link.connection.ondatachannel = (event) => {
        event.channel.onmessage = (messageEvent) => {
          const message = JSON.parse(messageEvent.data as string) as ChunkMessage;
          reassembler.push(message);
          setState({ phase: "transferring", receivedCount: reassembler.receivedCount(), totalItems: reassembler.totalItems() });

          if (reassembler.isDone()) {
            void applyBackupPayload(activeDb, reassembler.toBackupPayload()).then((result) => {
              linkRef.current?.close();
              linkRef.current = null;
              setState({ phase: "done", result });
            });
          }
        };
      };
    }

    function handleSignal(payload: unknown) {
      const { signal } = payload as { fromDeviceId: string; signal: RtcSignal };
      void linkRef.current?.handleSignal(signal);
    }

    function handleCancelled() {
      fail("The other device cancelled — try exporting a backup file instead.");
    }

    socket.on("device-link:peer-joined", handlePeerJoined);
    socket.on("device-link:signal", handleSignal);
    socket.on("device-link:cancelled", handleCancelled);

    return () => {
      socket.off("device-link:peer-joined", handlePeerJoined);
      socket.off("device-link:signal", handleSignal);
      socket.off("device-link:cancelled", handleCancelled);
      linkRef.current?.close();
      linkRef.current = null;
    };
  }, [socket, db]);

  return { state, start, cancel };
}

// ---- Source: the device that already has history, scanning/typing the code and sending ----

export type DeviceLinkSourceState =
  | { phase: "idle" }
  | { phase: "joining" }
  | { phase: "connecting" }
  | { phase: "sending"; sentItems: number; totalItems: number }
  | { phase: "done" }
  | { phase: "failed"; message: string };

export interface UseDeviceLinkSourceResult {
  state: DeviceLinkSourceState;
  join: (code: string) => Promise<void>;
  cancel: () => void;
}

export function useDeviceLinkSource(): UseDeviceLinkSourceResult {
  const { db } = useLocalStore();
  const { socket } = useSyncEngine();
  const [state, setState] = useState<DeviceLinkSourceState>({ phase: "idle" });
  const linkRef = useRef<PeerLink | null>(null);
  const codeRef = useRef<string | null>(null);

  const cancel = useCallback(() => {
    if (socket && codeRef.current) socket.emit("device-link:cancel", { code: codeRef.current });
    linkRef.current?.close();
    linkRef.current = null;
    codeRef.current = null;
    setState({ phase: "idle" });
  }, [socket]);

  useEffect(() => {
    if (!socket) return undefined;

    function handleSignal(payload: unknown) {
      const { signal } = payload as { fromDeviceId: string; signal: RtcSignal };
      void linkRef.current?.handleSignal(signal);
    }

    function handleCancelled() {
      linkRef.current?.close();
      linkRef.current = null;
      setState({ phase: "failed", message: "The other device cancelled." });
    }

    socket.on("device-link:signal", handleSignal);
    socket.on("device-link:cancelled", handleCancelled);

    return () => {
      socket.off("device-link:signal", handleSignal);
      socket.off("device-link:cancelled", handleCancelled);
      linkRef.current?.close();
      linkRef.current = null;
    };
  }, [socket]);

  const join = useCallback(
    (code: string) =>
      new Promise<void>((resolve) => {
        if (!socket || !db) {
          // Unlike the host's start() (a plain REST call), joining genuinely needs a live socket
          // to emit on — surface that rather than silently doing nothing (the same class of bug
          // just fixed in useDeviceLinkHost's start()).
          setState({ phase: "failed", message: "Still connecting — wait a moment and try again." });
          resolve();
          return;
        }
        setState({ phase: "joining" });

        socket.emit("device-link:join", { code }, (response: unknown) => {
          const { error, hostDeviceId } = response as { error?: string; hostDeviceId?: string };
          if (error || !hostDeviceId) {
            setState({ phase: "failed", message: "Invalid or expired code." });
            resolve();
            return;
          }

          codeRef.current = code;
          setState({ phase: "connecting" });

          const link = new PeerLink(socket, code, hostDeviceId, () => {
            setState({ phase: "failed", message: FALLBACK_MESSAGE });
          });
          linkRef.current = link;

          void (async () => {
            try {
              const channel = await link.createOffer();
              channel.onopen = () => {
                void (async () => {
                  const payload = await collectBackupPayload(db);
                  const messages = chunkBackupPayload(payload);
                  setState({ phase: "sending", sentItems: 0, totalItems: 0 });
                  await sendChunked(channel, messages, (sentItems, totalItems) => setState({ phase: "sending", sentItems, totalItems }));
                  setState({ phase: "done" });
                  linkRef.current?.close();
                  linkRef.current = null;
                })();
              };
            } catch {
              setState({ phase: "failed", message: FALLBACK_MESSAGE });
            }
          })();
          resolve();
        });
      }),
    [socket, db],
  );

  return { state, join, cancel };
}
