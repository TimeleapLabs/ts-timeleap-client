import { Wallet } from "./wallet.js";
import { Sia } from "@timeleap/sia";
import { base58, base64 } from "@scure/base";
import * as ed from "@noble/ed25519";
import { equal } from "./lib/util/uint8array.js";
import { Function } from "./function.js";
import type { Broker, FunctionRef, PromiseCallbacks } from "./types.js";

export class Client {
  private wallet: Wallet;
  private connection: WebSocket;
  private queue: Map<string, PromiseCallbacks> = new Map();
  private brokerPublicKey: Uint8Array;
  private textDecoder = new TextDecoder();

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
    const uuidBytes = sia.readByteArray8();
    const uuid = base64.encode(uuidBytes);
    const promise = this.queue.get(uuid);

    if (!promise) {
      return;
    }

    if (opcode[0] === 1) {
      const err = this.textDecoder.decode(buf.subarray(1));
      promise.reject(new Error(err));
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
  
    const innerBytes = sia.toUint8ArrayReference();
    const opcodeByte = innerBytes[0];
  
    const outer = Sia.alloc(innerBytes.length + 512)
                     .addByteArrayN(new Uint8Array([opcodeByte]))
                     .addByteArray64(innerBytes);
  
    const signedOuter = await this.wallet.signSia(outer);
  
    return new Promise((resolve, reject) => {
      this.queue.set(uuid, { resolve, reject });
      this.connection.send(signedOuter.toUint8ArrayReference());
    });
  }
  method(ref: FunctionRef) {
    return new Function(this, ref);
  }

  close() {
    this.connection.close();
  }
}
