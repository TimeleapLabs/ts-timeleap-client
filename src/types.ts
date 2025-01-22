export type Broker = {
  uri: string;
  publicKey: string;
};

export type FunctionRef = {
  plugin: string;
  method: string;
  timeout: number;
};

export type PromiseCallbacks = {
  resolve: (data: any) => void;
  reject: (err: Error) => void;
};
