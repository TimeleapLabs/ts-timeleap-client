import { Wallet } from "./wallet.js";
import { Function } from "./function.js";
import { OpCodes } from "./lib/opcodes.js";
import { Identity } from "./identity.js";
import { delay } from "./lib/util/time.js";

import { Sia } from "@timeleap/sia";
import { base64 } from "@scure/base";
import { uuidv7obj } from "uuidv7";

import type {
  Broker,
  ErrorCallback,
  FunctionRef,
  MessageCallback,
  ResolveMechanism,
} from "./types.js";

// TODO: We need to clean up the queue
export class Client {
  private wallet: Wallet;
  private connection: WebSocket;
  private queue: Map<string, ResolveMechanism> = new Map();
  private brokerPublicKey: string;
  private brokerIdentity?: Identity;
  private textDecoder = new TextDecoder();
  private eventHandlers: Map<string, MessageCallback[]> = new Map();
  private errorHandlers: ErrorCallback[] = [];
  private lastMessageAt = Date.now();
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private readonly HEARTBEAT_MS = 20_000;
  private readonly STALE_AFTER_MS = 45_000;
  private readonly FIRST_RECONNECT_DELAY_MS = 100;
  private readonly MAX_RECONNECT_DELAY_MS = 30_000;

  public broker: Broker;
  public appId: number = 0;

  constructor(wallet: Wallet, broker: Broker) {
    this.broker = broker;
    this.wallet = wallet;
    this.connection = new WebSocket(broker.uri);
    this.bindSocket(this.connection);
    this.brokerPublicKey = broker.publicKey;
  }

  private maybeThrow(error: Error) {
    if (this.errorHandlers.length === 0) {
      throw error;
    }

    for (const handler of this.errorHandlers) {
      handler(error);
    }
  }

  getResolve(uuid: Uint8Array) {
    return this.queue.get(base64.encode(uuid));
  }

  private bindSocket(ws: WebSocket) {
    ws.onopen = this.onopen;
    ws.onmessage = this.onmessage.bind(this);
    ws.onerror = this.onerror.bind(this);
    ws.onclose = this.onclose.bind(this);
    this.connection = ws;
  }

  private onopen = async () => {
    try {
      for (const topic of this.eventHandlers.keys()) {
        this.sendSubscribe(topic);
      }
      this.startHeartbeat();
    } catch (e) {
      console.error("WebSocket connection error:", e);
      this.maybeThrow(e as Error);
      this.connection?.close();
    }
  };

  private onclose(event: CloseEvent) {
    console.error("WebSocket closed:", event);
    this.stopHeartbeat();
  }

  private onerror(event: Event) {
    console.error("WebSocket error:", event);
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      const stale = now - this.lastMessageAt > this.STALE_AFTER_MS;
      const open = this.connection?.readyState === WebSocket.OPEN;

      if (!open || stale) {
        console.warn("WebSocket connection is stale or closed");
        return this.close();
      }

      try {
        this.connection.send(Buffer.from([OpCodes.Ping]));
      } catch (error) {
        console.error("WebSocket heartbeat error:", error);
        this.close();
      }
    }, this.HEARTBEAT_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  async onmessage(event: MessageEvent) {
    this.lastMessageAt = Date.now();
    const data = event.data;
    const buf =
      data instanceof Uint8Array
        ? data
        : new Uint8Array(await (data as Blob).arrayBuffer());

    const sia = new Sia(buf);
    const opcode = sia.readUInt8();

    if (opcode === OpCodes.Pong) {
      return; // Do nothing
    }

    const appId = sia.readUInt64();
    if (appId !== this.appId) {
      return this.maybeThrow(new Error(`Invalid appId: ${appId}`));
    }

    if (opcode === OpCodes.Error) {
      const errText = this.textDecoder.decode(buf.subarray(9, -96));
      const err = new Error(errText);
      return this.maybeThrow(err);
    }

    if (opcode === OpCodes.RPCResponse) {
      const uuidBytes = sia.readByteArray8();
      const uuid = base64.encode(uuidBytes);
      const promise = this.queue.get(uuid);

      if (!promise) {
        return;
      }

      const valid = await this.brokerIdentity!.verify(buf);
      if (!valid) {
        return promise.reject(new Error("Invalid signature"));
      }

      return promise.resolve(buf);
    }

    if (opcode === OpCodes.RPCStream) {
      const uuidBytes = sia.readByteArray8();
      const uuid = base64.encode(uuidBytes);
      const stream = this.queue.get(uuid);

      if (!stream || !stream.controller) {
        return this.maybeThrow(new Error("Stream not found"));
      }

      const valid = await this.brokerIdentity!.verify(buf);
      if (!valid) {
        console.error("RPCStream verification failed:", { uuid, buf });
        return stream.controller.error(new Error("Invalid signature"));
      }

      // Enqueue the stream data (excluding the header and signature)
      return stream.controller.enqueue(buf.slice(26, -96));
    }

    if (opcode === OpCodes.Broadcast) {
      const valid = await this.brokerIdentity!.verify(buf);
      if (!valid) {
        return this.maybeThrow(new Error("Invalid signature"));
      }

      const msgBuf = buf.slice(1, buf.length - 96);
      const sia = new Sia(msgBuf);

      const msgOpcode = sia.readByteArrayN(1);
      if (msgOpcode[0] !== OpCodes.Message) {
        return this.maybeThrow(
          new Error(`Invalid message opcode: ${msgOpcode[0]}`)
        );
      }

      const uuid = sia.readByteArray8();
      const timestamp = sia.readUInt64();
      const topic = sia.readString16();
      const content = sia.readByteArray32();
      const signer = msgBuf.subarray(msgBuf.length - 96, msgBuf.length - 64);
      const signerIdentity = await Identity.fromPublicKey(signer);

      const msgValid = await signerIdentity.verify(msgBuf);
      if (!msgValid) {
        return this.maybeThrow(new Error("Invalid message signature"));
      }

      const message = {
        signer,
        signature: buf.slice(buf.length - 64),
        uuid,
        timestamp,
        topic,
        content,
      };

      for (const handler of this.getHandlersForTopic(topic)) {
        handler(message);
      }

      return;
    }

    this.maybeThrow(new Error(`Unknown opcode: ${opcode}`));
  }

  private getHandlersForTopic(topic: string) {
    const handlers: MessageCallback[] = [];
    for (const [key, value] of this.eventHandlers.entries()) {
      if (topic.startsWith(key)) {
        handlers.push(...value);
      }
    }
    return handlers;
  }

  async wait() {
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        this.connection.removeEventListener("error", onError);
        resolve();
      };
      const onError = (ev: Event) => {
        this.connection.removeEventListener("open", onOpen);
        reject(ev);
      };
      this.connection.addEventListener("open", onOpen, { once: true });
      this.connection.addEventListener("error", onError, { once: true });
    });

    this.brokerIdentity = await Identity.fromBase58(this.brokerPublicKey);

    const httpUri = this.broker.uri
      .replace("ws://", "http://")
      .replace("wss://", "https://");

    const appInfoResp = await fetch(httpUri + "/app");
    const appInfo = await appInfoResp.json();
    this.appId = appInfo.appId;
  }

  static async connect(wallet: Wallet, broker: Broker) {
    const client = new Client(wallet, broker);
    await client.wait();
    return client;
  }

  private async reconnect() {
    if (this.connection && this.connection.readyState === WebSocket.OPEN) {
      return;
    }

    let currentDelay = this.FIRST_RECONNECT_DELAY_MS;
    while (this.connection && this.connection.readyState !== WebSocket.OPEN) {
      try {
        console.warn("Attempting WebSocket reconnection...");
        await delay(currentDelay);
        this.connection = new WebSocket(this.broker.uri);
        await this.wait();
        return;
      } catch (error) {
        console.error("WebSocket reconnection error:", error);
        currentDelay = Math.min(currentDelay * 2, this.MAX_RECONNECT_DELAY_MS);
      }
    }
  }

  async send(sia: Sia) {
    await this.reconnect();

    const { offset } = sia;
    const uuidBytes = sia.seek(9).readByteArray8();
    sia.seek(offset);

    const uuid = base64.encode(uuidBytes);
    const signed = await this.wallet.signSia(sia);
    return new Promise<Uint8Array>((resolve, reject) => {
      this.queue.set(uuid, { resolve, reject });
      this.connection.send(signed.toUint8ArrayReference());
    });
  }

  async stream(sia: Sia) {
    await this.reconnect();

    const { offset } = sia;
    const uuidBytes = sia.seek(9).readByteArray8();
    sia.seek(offset);

    const uuid = base64.encode(uuidBytes);
    const signed = await this.wallet.signSia(sia);
    const { promise, resolve, reject } = Promise.withResolvers<Uint8Array>();

    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        this.queue.set(uuid, { resolve, reject, controller });
        this.connection.send(signed.toUint8ArrayReference());
      },
    });

    return { stream, promise };
  }

  async sendWithoutId(sia: Sia) {
    const signed = await this.wallet.signSia(sia);
    this.connection.send(signed.toUint8ArrayReference());
  }

  async broadcast(timestamp: number, topic: string, content: Uint8Array) {
    const uuid = uuidv7obj().bytes;
    const sia = Sia.alloc(512)
      .addByteArrayN(new Uint8Array([OpCodes.Message]))
      .addUInt64(this.appId)
      .addByteArray8(uuid)
      .addUInt64(timestamp)
      .addString16(topic)
      .addByteArray32(content);
    return this.sendWithoutId(sia);
  }

  method(ref: FunctionRef) {
    return new Function(this, ref);
  }

  subscribeToErrors(handler: ErrorCallback) {
    this.errorHandlers.push(handler);
  }

  unsubsribeFromErrors(handler: ErrorCallback) {
    const index = this.errorHandlers.indexOf(handler);
    if (index !== -1) {
      this.errorHandlers.splice(index, 1);
    }
  }

  private sendSubscribe(topic: string) {
    const sia = Sia.alloc(512)
      .addByteArrayN(new Uint8Array([OpCodes.Subscribe]))
      .addUInt64(this.appId)
      .addString16(topic);
    this.sendWithoutId(sia);
  }

  private sendUnsubscribe(topic: string) {
    const sia = Sia.alloc(512)
      .addByteArrayN(new Uint8Array([OpCodes.Unsubscribe]))
      .addUInt64(this.appId)
      .addString16(topic);
    this.sendWithoutId(sia);
  }

  subscribe(topic: string, handler: MessageCallback) {
    const handlers = this.eventHandlers.get(topic) || [];
    handlers.push(handler);
    this.eventHandlers.set(topic, handlers);
    this.sendSubscribe(topic);
  }

  unsubsribe(topic: string, handler: MessageCallback) {
    const handlers = this.eventHandlers.get(topic) || [];
    const index = handlers.indexOf(handler);
    if (index !== -1) {
      handlers.splice(index, 1);
    }
    this.sendUnsubscribe(topic);
  }

  unsubsribeAll(topic: string) {
    this.eventHandlers.delete(topic);
    this.sendUnsubscribe(topic);
  }

  unsubsribeAllEvents() {
    for (const topic of this.eventHandlers.keys()) {
      this.sendUnsubscribe(topic);
    }
    this.eventHandlers.clear();
  }

  close() {
    this.connection.close();
  }
}
