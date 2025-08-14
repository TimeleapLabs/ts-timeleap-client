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

  private prepare() {
    const length = this.buffered.length + 96;
    const payload = Sia.alloc(length).embedBytes(this.buffered);

    const uuid = uuidv7obj().bytes;
    payload.seek(9).addByteArray8(uuid).seek(this.buffered.length);

    return { uuid, payload };
  }

  private stripAndGetErrors(response: Uint8Array) {
    const sia = new Sia(new Uint8Array(response.subarray(26, -96)));
    const error = sia.readUInt16();
    return { error, sia };
  }

  private stripAndCheckForErrors(response: Uint8Array) {
    const { error, sia } = this.stripAndGetErrors(response);
    if (error !== 0) {
      throw new Error(`Error code: ${error}`);
    }
    return sia;
  }

  async invoke() {
    const { payload } = this.prepare();
    const response = await this.client.send(payload);
    return this.stripAndCheckForErrors(response);
  }

  async stream() {
    const { payload, uuid } = this.prepare();
    const { promise, stream } = await this.client.stream(payload);
    return { promise: this.wrapStreamPromise(promise, uuid), stream };
  }

  wrapStreamPromise(promise: Promise<Uint8Array>, uuid: Uint8Array) {
    return new Promise<Sia>((resolve, reject) => {
      promise
        .then((response) => {
          const { error, sia } = this.stripAndGetErrors(response);
          const { controller } = this.client.getResolve(uuid) || {};
          if (error !== 0) {
            controller?.error(new Error(`Error code: ${error}`));
            reject(new Error(`Error code: ${error}`));
          } else {
            try {
              controller?.close();
            } finally {
              resolve(sia);
            }
          }
        })
        .catch((error) => {
          reject(error);
        });
    });
  }
}

export class Function {
  private client: Client;
  private buffered: Uint8Array;
  constructor(client: Client, ref: FunctionRef) {
    this.client = client;
    this.buffered = Sia.alloc(512)
      .addUInt8(OpCodes.RPCRequest)
      .addUInt64(client.appId)
      .addByteArray8(new Uint8Array(Array.from({ length: 16 }, () => 0)))
      .addAscii(ref.plugin)
      .addAscii(ref.method)
      .addUInt64(ref.timeout)
      .addUInt64(ref.fee.amount)
      .addAscii(ref.fee.currency)
      .toUint8Array();
  }

  populate(args: Sia) {
    const length = this.buffered.length + args.content.length;
    const wrapped = Sia.alloc(length).embedBytes(this.buffered).embedSia(args);
    return new PopulatedFunction(this.client, wrapped.toUint8Array());
  }
}
