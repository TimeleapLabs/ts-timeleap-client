export type Broker = {
  uri: string;
  publicKey: string;
};

export type Fee = {
  amount: number;
  currency: string;
};

export type FunctionRef = {
  plugin: string;
  method: string;
  timeout: number;
  fee: Fee;
};

export type PromiseCallbacks = {
  resolve: (data: any) => void;
  reject: (err: Error) => void;
};

export type Message = {
  signer: Uint8Array;
  signature: Uint8Array;
  uuid: Uint8Array;
  timestamp: number;
  topic: string;
  content: Uint8Array;
};

export type ErrorCallback = (err: Error) => void;
export type MessageCallback = (msg: Message) => void;
