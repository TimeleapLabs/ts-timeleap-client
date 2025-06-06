export const OpCodes = {
  Feedback: 0,
  Error: 1,

  Subscribe: 2,
  Unsubscribe: 3,
  Message: 4,
  Broadcast: 5,

  RegisterWorker: 6,
  WorkerOverload: 7,
  TaskFailed: 8,

  RPCRequest: 9,
  RPCResponse: 10,
  RPCStream: 11,
};
