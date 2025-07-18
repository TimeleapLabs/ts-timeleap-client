import { Sia } from "@timeleap/sia";
import { Client } from "../client.js";
import { Function } from "../function.js";

export interface EmptyArgs {}

export function encodeEmptyArgs(sia: Sia, emptyArgs: EmptyArgs): Sia {
  return sia;
}

export function decodeEmptyArgs(sia: Sia): EmptyArgs {
  return {};
}

export interface GeneratedImageResponse {
  uuid: Uint8Array | Buffer;
  error?: number;
  image?: Uint8Array | Buffer;
}

export function encodeGeneratedImageResponse(
  sia: Sia,
  generatedImageResponse: GeneratedImageResponse
): Sia {
  sia.addByteArray8(generatedImageResponse.uuid);
  sia.addUInt16(generatedImageResponse.error ?? 0);
  sia.addByteArray32(generatedImageResponse.image ?? new Uint8Array(0));
  return sia;
}

export function decodeGeneratedImageResponse(sia: Sia): GeneratedImageResponse {
  return {
    uuid: sia.readByteArray8(),
    error: sia.readUInt16(),
    image: sia.readByteArray32(),
  };
}

export class StreamImagePlugin {
  private methods: Map<string, Function> = new Map();
  private pluginName = "timeleap.stream.test";

  constructor(private client: Client) {}

  static connect(client: Client): StreamImagePlugin {
    return new StreamImagePlugin(client);
  }

  private getMethod(
    method: string,
    timeout: number,
    fee: { currency: string; amount: number }
  ): Function {
    if (!this.methods.has(method)) {
      this.methods.set(
        method,
        this.client.method({
          plugin: this.pluginName,
          method,
          timeout,
          fee,
        })
      );
    }
    return this.methods.get(method)!;
  }

  public async streamImage(
    sia: Sia,
    emptyArgs: EmptyArgs
  ): Promise<{
    image: Uint8Array | Buffer;
  }> {
    encodeEmptyArgs(sia, emptyArgs);
    const method = this.getMethod("streamImage", 5000, {
      currency: "TLP",
      amount: 0,
    });
    const response = await method.populate(sia).invoke();
    const value = response.readByteArray32();
    return {
      image: value,
    };
  }
}
