import { Wallet } from "./wallet.js";
import { Sia } from "@timeleap/sia";
import { base64 } from "@scure/base";

export class Client {
  private wallet: Wallet;
  private connection: WebSocket;
  private queue: Map<string, (data: any) => void> = new Map();

  constructor(wallet: Wallet, url: string) {
    this.wallet = wallet;
    this.connection = new WebSocket(url);
    this.connection.onmessage = this.onmessage.bind(this);
  }

  async onmessage(event: MessageEvent) {
    const data = event.data as Blob;
    const buf = new Uint8Array(await data.arrayBuffer());
    const uuidBytes = new Sia(buf).seek(1).readByteArray8();
    const uuid = base64.encode(uuidBytes);
    const resolve = this.queue.get(uuid);
    if (resolve) {
      resolve(buf);
      this.queue.delete(uuid);
    }
  }

  wait() {
    return new Promise((resolve) => {
      this.connection.onopen = () => {
        resolve(this);
      };
    });
  }

  static async connect(wallet: Wallet, url: string) {
    const client = new Client(wallet, url);
    await client.wait();
    return client;
  }

  async send(sia: Sia) {
    const ref = sia.toUint8ArrayReference();
    const uuidBytes = new Sia(ref).seek(1).readByteArray8();
    const uuid = base64.encode(uuidBytes);
    const signed = await this.wallet.signSia(sia);
    return new Promise<Uint8Array>((resolve) => {
      this.queue.set(uuid, resolve);
      this.connection.send(signed.toUint8ArrayReference());
    });
  }

  close() {
    this.connection.close();
  }
}
