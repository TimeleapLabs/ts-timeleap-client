import { WebSocketServer } from "ws";
import { Sia } from "@timeleap/sia";
import { Uuid25 } from "uuid25";
import fs from "fs";
import path from "path";
import { buffer } from "stream/consumers";
import { randomUUID } from "crypto";
import { uuidv7obj } from "uuidv7";

const SERVER_PORT = 3000;
const IMAGE_PATH = path.join(process.cwd(), "debug.jpg");
const CHUNK_SIZE = 16 * 1024;
const CHUNK_DELAY_MS = 10;

const RPC_STREAM_OPCODE = 11;
const BROKER_ERROR_OPCODE = 1;

const wss = new WebSocketServer({ port: 3000 });
console.log(`WebSocket server started on port ${SERVER_PORT}`);

let imageBuffer;
try {
  imageBuffer = fs.readFileSync(IMAGE_PATH);
  console.log(`Loaded image: ${IMAGE_PATH} (${imageBuffer.length} bytes)`);
} catch (error) {
  console.error(`Error loading image from ${IMAGE_PATH}:`, error);
  console.error(
    "Please ensure 'debug.jpg' exists in the same directory as the server script."
  );
  process.exit(1);
}

wss.on("connection", (ws) => {
  console.log("Client connected.");

  ws.on("message", async (buf: Buffer) => {
    const sia = new Sia(buf);
    console.log("i got message", buffer.length);

    const incomingOpcode = sia.readUInt8();
    const appId = sia.readUInt64();

    const requestUuidBytes = sia.readByteArray8();
    sia.readByteArray32(); // Skip signature
    const plugin = sia.readAscii();
    const method = sia.readAscii();

    const requestUuidStr = Uuid25.fromBytes(requestUuidBytes).toHyphenated();

    console.log(
      `Received RPC Stream Request: ${plugin}.${method} (Request ID: ${requestUuidStr})`
    );

    if (plugin === "timeleap.stream.test" && method === "StreamImage") {
      let chunkIndex = 0;
      let bytesSent = 0;

      while (bytesSent < imageBuffer.length) {
        const start = bytesSent;
        const end = Math.min(bytesSent + CHUNK_SIZE, imageBuffer.length);
        const chunk = imageBuffer.subarray(start, end);

        const uuid = uuidv7obj().bytes;

        const streamUuid = uuid;

        const finished = end === imageBuffer.length;

        const streamResponsePayload = new Sia()
          .addByteArray8(requestUuidBytes) // Original RPC Request ID
          .addByteArray8(streamUuid) // Stream ID
          .addString8("image/jpeg") // Type of stream
          .addInt64(chunkIndex) // Chunk index
          .addBool(finished) // Is this the last chunk?
          .addByteArray32(chunk); // The actual data chunk

        const fullMessage = new Sia()
          .addUInt8(RPC_STREAM_OPCODE)
          .addUInt64(appId)
          .addByteArrayN(streamResponsePayload.toUint8ArrayReference());

        ws.send(fullMessage.toUint8Array());
        console.log(
          `Sent chunk #${chunkIndex} (${chunk.length} bytes), Finished: ${finished}`
        );

        bytesSent += chunk.length;
        chunkIndex++;

        // small delay for demonstration/network simulation
        if (!finished && CHUNK_DELAY_MS > 0) {
          await new Promise((resolve) => setTimeout(resolve, CHUNK_DELAY_MS));
        }
      }
      console.log(
        `Finished streaming image for request ${requestUuidStr}. Total chunks: ${chunkIndex}`
      );
    } else {
      console.warn(
        `Invalid stream plugin/method requested: ${plugin}.${method}`
      );
      const errorMessage = `Plugin or method not found for streaming: ${plugin}.${method}`;
      const errorResponse = new Sia()
        .addUInt8(BROKER_ERROR_OPCODE)
        .addUInt64(appId)
        .addAscii(errorMessage);

      ws.send(errorResponse.toUint8Array());
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected.");
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });
});
