import { base58 } from "@scure/base";
import { Sia } from "@timeleap/sia";
import * as ed from "@noble/ed25519";

export class Identity {
  public publicKey: ed.Bytes;

  constructor() {
    this.publicKey = Buffer.alloc(0);
  }

  static async fromPublicKey(publicKey: ed.Bytes) {
    const identity = new Identity();
    identity.publicKey = publicKey;
    return identity;
  }

  static async fromBase58(base58PublicKey: string) {
    return Identity.fromPublicKey(base58.decode(base58PublicKey));
  }

  toBase58() {
    return {
      publicKey: base58.encode(this.publicKey),
    };
  }

  async verify(data: ed.Bytes): Promise<boolean> {
    const auth = new Sia(data.subarray(-96));
    const signer = auth.readByteArrayN(32);
    const signature = auth.readByteArrayN(64);

    if (!this.compare(signer, this.publicKey)) {
      return false;
    }

    const ref = data.subarray(0, data.length - 96);
    return ed.verifyAsync(signature, ref, this.publicKey);
  }

  private compare(a: ed.Bytes, b: ed.Bytes) {
    return a.length === b.length && a.every((byte, index) => byte === b[index]);
  }
}
