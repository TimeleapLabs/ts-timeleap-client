import { Client } from "./client.js";
import { Sia } from "@timeleap/sia";
import { uuidv7obj } from "uuidv7";
import type { FunctionRef } from "./types.js";
import { OpCodes } from "./lib/opcodes.js";

export class PopulatedFunction {
  private client: Client;
  private buffered: Uint8Array;

  constructor(client: Client, buffered: Uint8Array) {
    this.client = client;
    this.buffered = buffered;
  }

  async invoke() {
    const length = this.buffered.length + 96;
    const payload = Sia.alloc(length).embedBytes(this.buffered);

    const uuid = uuidv7obj().bytes;
    payload.seek(1).addByteArray8(uuid).seek(this.buffered.length);

    const response = await this.client.send(payload);
    const sia = new Sia(new Uint8Array(response.subarray(18)));
    const error = sia.readUInt16();
    if (error !== 0) {
      throw new Error(`Error code: ${error}`);
    }

    return sia;
  }
}

export class Function {
  private client: Client;
  private buffered: Uint8Array;
  constructor(client: Client, ref: FunctionRef) {
    this.client = client;
    this.buffered = Sia.alloc(512)
      .addByteArrayN(new Uint8Array([OpCodes.RPCRequest]))
      .addByteArray8(new Uint8Array(Array.from({ length: 16 }, () => 0)))
      .addAscii(ref.plugin)
      .addAscii(ref.method)
      .addUInt64(ref.timeout)
      .toUint8Array();
  }

  populate(args: Sia) {
    const length = this.buffered.length + args.content.length;
    const wrapped = Sia.alloc(length).embedBytes(this.buffered).embedSia(args);
    return new PopulatedFunction(this.client, wrapped.toUint8Array());
  }
}
