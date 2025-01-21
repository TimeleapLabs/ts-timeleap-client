# TypeScript Unchained Client

The Unchained Client library provides programmatic access to the Unchained network.
This library provides the following classes:

```TypeScript
import { Wallet } from "@timeleap/unchained-client"

const wallet = await Wallet.random()
console.log(wallet.encode())
```

```TypeScript
import { Client } from "@timeleap/unchained-client"

const client = Client.connect(wallet, unchainedBrokerURI)
const response = await client.send(rpcRequest)
```

## Documentation

WIP
