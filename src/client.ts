import { Wallet } from "./wallet.js";
import { Function } from "./function.js";
import { OpCodes } from "./lib/opcodes.js";
import { Identity } from "./identity.js";

import { Sia } from "@timeleap/sia";
import { base64 } from "@scure/base";
import { uuidv7obj } from "uuidv7";

import type {
  Broker,
  ErrorCallback,
  FunctionRef,
  MessageCallback,
  PromiseCallbacks,
} from "./types.js";

export class Client {
  private wallet: Wallet;
  private connection: WebSocket;
  private queue: Map<string, PromiseCallbacks> = new Map();
  private brokerPublicKey: string;
  private brokerIdentity?: Identity;
  private textDecoder = new TextDecoder();
  private eventHandlers: Map<string, MessageCallback[]> = new Map();
  private errorHandlers: ErrorCallback[] = [];

  public broker: Broker;
  public appId: number = 0;

  constructor(wallet: Wallet, broker: Broker) {
    this.broker = broker;
    this.wallet = wallet;
    this.connection = new WebSocket(broker.uri);
    this.connection.onmessage = this.onmessage.bind(this);
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

  async onmessage(event: MessageEvent) {
    const data = event.data;
    const buf =
      data instanceof Uint8Array
        ? data
        : new Uint8Array(await (data as Blob).arrayBuffer());

    const sia = new Sia(buf);
    const opcode = sia.readByteArrayN(1);
    const appId = sia.readUInt64();

    if (appId !== this.appId) {
      return this.maybeThrow(new Error(`Invalid appId: ${appId}`));
    }

    if (opcode[0] === OpCodes.Error) {
      const errText = this.textDecoder.decode(buf.subarray(9, -96));
      const err = new Error(errText);
      return this.maybeThrow(err);
    }

    if (opcode[0] === OpCodes.RPCResponse) {
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

    if (opcode[0] === OpCodes.Broadcast) {
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

    this.maybeThrow(new Error(`Unknown opcode: ${opcode[0]}`));
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
    await new Promise((resolve, reject) => {
      this.connection.onopen = () => {
        this.connection.onerror = null;
        resolve(this);
      };
      this.connection.onerror = (err) => {
        reject(err);
      };
    });

    this.brokerIdentity = await Identity.fromBase58(this.brokerPublicKey);

    const appInfoResp = await fetch(this.broker.uri + "/app");
    const appInfo = await appInfoResp.json();
    this.appId = appInfo.appId;
  }

  static async connect(wallet: Wallet, broker: Broker) {
    const client = new Client(wallet, broker);
    await client.wait();
    return client;
  }

  async send(sia: Sia) {
    const { offset } = sia;
    const uuidBytes = sia.seek(1).readByteArray8();
    sia.seek(offset);
    const uuid = base64.encode(uuidBytes);
    const signed = await this.wallet.signSia(sia);
    return new Promise<Uint8Array>((resolve, reject) => {
      this.queue.set(uuid, { resolve, reject });
      this.connection.send(signed.toUint8ArrayReference());
    });
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
