import type { MessageSendAck, SyncEngineSocket } from "../types.js";

type Listener = (...args: never[]) => void;

/**
 * A minimal in-memory stand-in for socket.io-client's Socket, implementing only what
 * SyncEngineSocket needs. No real network — tests drive it directly via the trigger* methods
 * (simulating server -> client events) and inspect `outgoingEvents` (what the engine sent).
 */
export class FakeSocket implements SyncEngineSocket {
  connected = false;
  outgoingEvents: { event: string; args: unknown[] }[] = [];

  private listeners = new Map<string, Set<Listener>>();
  private messageSendHandler?: (payload: unknown) => MessageSendAck | Promise<MessageSendAck>;

  on(event: string, handler: Listener): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)?.add(handler);
  }

  off(event: string, handler?: Listener): void {
    if (!handler) {
      this.listeners.delete(event);
      return;
    }
    this.listeners.get(event)?.delete(handler);
  }

  emit(event: string, ...args: unknown[]): void {
    this.outgoingEvents.push({ event, args });

    if (event === "message:send") {
      const [payload, ack] = args as [unknown, ((response: MessageSendAck) => void)?];
      void this.respondToMessageSend(payload, ack);
    }
  }

  /** Registers how this fake "server" responds to message:send — call before triggering a send. */
  onMessageSend(handler: (payload: unknown) => MessageSendAck | Promise<MessageSendAck>): void {
    this.messageSendHandler = handler;
  }

  triggerConnect(): void {
    this.connected = true;
    this.fire("connect");
  }

  triggerEnvelopeDeliver(envelope: unknown): void {
    this.fire("envelope:deliver", envelope);
  }

  triggerDormancyReturn(): void {
    this.fire("dormancy:return");
  }

  private async respondToMessageSend(payload: unknown, ack?: (response: MessageSendAck) => void): Promise<void> {
    if (!this.messageSendHandler) return;
    const response = await this.messageSendHandler(payload);
    ack?.(response);
  }

  private fire(event: string, ...args: unknown[]): void {
    for (const handler of this.listeners.get(event) ?? []) {
      (handler as (...a: unknown[]) => void)(...args);
    }
  }
}
