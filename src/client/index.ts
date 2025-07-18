import { Sia } from "@timeleap/sia";
import { uuidv7obj } from "uuidv7";
import fs from "node:fs/promises";
import { config } from "dotenv";
import { Wallet } from "../wallet.js";
import { Client } from "../client.js";
import { StreamImagePlugin } from "../model/stream.js";

config();

async function runStreamTest() {
  // let fileHandle: fs.FileHandle | null = null;
  // const outputFilePath = "./downloaded_image.bin";
  // let expectedChunkIndex = 0;

  const uri = process.env.BROKER_URI;
  const publicKey = process.env.BROKER_PUBLIC_KEY;
  const privateKey = process.env.CLIENT_PRIVATE_KEY;

  if (!uri || !publicKey || !privateKey) {
    throw new Error(
      "Missing env vars: BROKER_URI, BROKER_PUBLIC_KEY, CLIENT_PRIVATE_KEY"
    );
  }

  try {
    const wallet = await Wallet.fromBase58(privateKey);
    const client = await Client.connect(wallet, { uri, publicKey });
    const streamer = StreamImagePlugin.connect(client);

    const args = {};
    const buffer = 64;
    const response = await streamer.streamImage(Sia.alloc(buffer), args);

    console.log(response.image.length);

    // const streamEmitter = client.getStream(requestUuid.toString());

    // streamEmitter.on("data", async (chunkData) => {
    //   console.log(
    //     `Received chunk #${chunkData.index} (Type: ${chunkData.type}, Size: ${chunkData.data.length} bytes), Finished: ${chunkData.finished}`
    //   );
    //   if (chunkData.index !== expectedChunkIndex) {
    //     console.warn(
    //       `Chunk order mismatch! Expected ${expectedChunkIndex}, got ${chunkData.index}`
    //     );
    //   }
    //   expectedChunkIndex = chunkData.index + 1;

    //   try {
    //     if (!fileHandle) {
    //       fileHandle = await fs.open(outputFilePath, "w");
    //       console.log(`Opened file for writing: ${outputFilePath}`);
    //     }
    //     await fileHandle.write(chunkData.data);
    //   } catch (writeErr) {
    //     console.error(
    //       `Error writing chunk #${chunkData.index} to file:`,
    //       writeErr
    //     );
    //     streamEmitter.emit("error", new Error(`File write error: ${writeErr}`));
    //   }

    //   if (chunkData.finished) {
    //     console.log(
    //       `Stream finished. Total chunks received: ${chunkData.index + 1}`
    //     );
    //     if (fileHandle) {
    //       await fileHandle.close();
    //       console.log(`File closed: ${outputFilePath}`);
    //     }
    //     // client.unsubscribeFromStream(chunkData.streamId);
    //     client.close();
    //   }
    // });

    // streamEmitter.on("end", () => {
    //   console.log(
    //     `Stream emitter for ${requestUuid.toString()} signaled 'end'.`
    //   );
    // });

    // streamEmitter.on("error", (err) => {
    //   console.error(`Stream emitter for ${requestUuid.toString()} error:`, err);
    //   if (fileHandle)
    //     fileHandle
    //       .close()
    //       .catch((e) =>
    //         console.error("Error closing file after stream error:", e)
    //       );
    //   if (client) client.close();
    // });
  } catch (error) {
    console.error("Critical error during test setup or execution:", error);
  }
}

runStreamTest();
