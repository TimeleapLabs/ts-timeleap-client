import { Wallet } from "./wallet.js";
import { Sia } from "@timeleap/sia";
import { base58, base64 } from "@scure/base";
import * as ed from "@noble/ed25519";
import { equal } from "./lib/util/uint8array.js";
import { Function } from "./function.js";
import { OpCodes } from "./lib/opcodes.js";

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
  private brokerPublicKey: Uint8Array;
  private textDecoder = new TextDecoder();
  private eventHandlers: Map<string, MessageCallback[]> = new Map();
  private errorHandlers: ErrorCallback[] = [];

  constructor(wallet: Wallet, broker: Broker) {
    this.wallet = wallet;
    this.connection = new WebSocket(broker.uri);
    this.connection.onmessage = this.onmessage.bind(this);
    this.brokerPublicKey = base58.decode(broker.publicKey);
  }

  async onmessage(event: MessageEvent) {
    const data = event.data as Blob;
    const buf = new Uint8Array(await data.arrayBuffer());
    const sia = new Sia(buf);
    const opcode = sia.readByteArrayN(1);

    if (opcode[0] === OpCodes.Error) {
      const errText = this.textDecoder.decode(buf.subarray(1));
      const err = new Error(errText);

      if (this.errorHandlers.length === 0) {
        throw err;
      }

      for (const handler of this.errorHandlers) {
        handler(err);
      }

      return;
    }

    if (opcode[0] === OpCodes.RPCResponse) {
      const uuidBytes = sia.readByteArray8();
      const uuid = base64.encode(uuidBytes);
      const promise = this.queue.get(uuid);

      if (!promise) {
        return;
      }

      const auth = new Sia(buf.subarray(-96));
      const signer = auth.readByteArrayN(32);
      const signature = auth.readByteArrayN(64);

      // signer should be the broker public key
      if (!equal(this.brokerPublicKey, signer)) {
        return promise.reject(new Error("Invalid signer"));
      }

      // verify the signature
      const message = buf.subarray(0, buf.length - 96);
      const valid = await ed.verifyAsync(signature, message, signer);
      if (!valid) {
        return promise.reject(new Error("Invalid signature"));
      }

      promise.resolve(buf);
    }

    throw new Error(`Unknown opcode: ${opcode[0]}`);
  }

  wait() {
    return new Promise((resolve) => {
      this.connection.onopen = () => {
        resolve(this);
      };
    });
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

  subscribe(event: string, handler: MessageCallback) {
    // TODO: Send subscribe opcode to broker
    const handlers = this.eventHandlers.get(event) || [];
    handlers.push(handler);
    this.eventHandlers.set(event, handlers);
  }

  unsubsribe(event: string, handler: MessageCallback) {
    // TODO: Send unsubscribe opcode to broker
    const handlers = this.eventHandlers.get(event) || [];
    const index = handlers.indexOf(handler);
    if (index !== -1) {
      handlers.splice(index, 1);
    }
  }

  unsubsribeAll(event: string) {
    // TODO: Send unsubscribe opcode to broker
    this.eventHandlers.delete(event);
  }

  unsubsribeAllEvents() {
    // TODO: Send unsubscribe opcode to broker
    this.eventHandlers.clear();
  }

  close() {
    this.connection.close();
  }
}
