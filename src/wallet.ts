import { base58 } from "@scure/base";
import { Sia } from "@timeleap/sia";
import * as ed from "@noble/ed25519";

export class Wallet {
  public publicKey: ed.Bytes;
  public privateKey: ed.Bytes;

  constructor() {
    this.publicKey = Buffer.alloc(0);
    this.privateKey = Buffer.alloc(0);
  }

  static async random() {
    const wallet = new Wallet();

    wallet.privateKey = ed.utils.randomPrivateKey();
    wallet.publicKey = await ed.getPublicKeyAsync(wallet.privateKey);

    return wallet;
  }

  static async fromPrivateKey(privateKey: ed.Bytes) {
    const wallet = new Wallet();

    wallet.privateKey = privateKey;
    wallet.publicKey = await ed.getPublicKeyAsync(privateKey);

    return wallet;
  }

  static async fromBase58(base58PrivateKey: string) {
    return Wallet.fromPrivateKey(base58.decode(base58PrivateKey));
  }

  toBase58() {
    return {
      publicKey: base58.encode(this.publicKey),
      privateKey: base58.encode(this.privateKey),
    };
  }

  async sign(data: ed.Bytes) {
    const signature = await ed.signAsync(data, this.privateKey);
    return Buffer.concat([data, this.publicKey, signature]);
  }

  async signSia(sia: Sia) {
    const ref = sia.toUint8ArrayReference();
    const signature = await ed.signAsync(ref, this.privateKey);
    return sia.addByteArrayN(this.publicKey).addByteArrayN(signature);
  }
}
