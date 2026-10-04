import type { IncomingMessage } from "node:http";

export async function incomingMessageToWebRequest(
  request: IncomingMessage,
  targetUrl: string,
): Promise<Request> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return new Request(targetUrl, {
    body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
    headers: request.headers as HeadersInit,
    method: request.method ?? "GET",
  });
}
