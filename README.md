# TypeScript Timeleap Client

The Timeleap Client library provides programmatic access to the Timeleap network.
This library provides the following classes:

```TypeScript
import { Wallet } from "@timeleap/client"

const wallet = await Wallet.random()
console.log(wallet.toBase58())
```

```TypeScript
import { Client } from "@timeleap/client"

const client = await Client.connect(wallet, TimeleapBrokerURI)
const response = await client.send(rpcRequest)
```

## Documentation

WIP
