type NodeResponseLike = {
  end(chunk?: Buffer): void;
  setHeader(key: string, value: number | string | string[]): void;
  statusCode: number;
  write(chunk: Buffer): boolean | void;
  once?(event: "drain", listener: () => void): unknown;
};

export async function writeWebResponseToNodeResponse(
  serverResponse: NodeResponseLike,
  response: Response,
) {
  serverResponse.statusCode = response.status;
  response.headers.forEach((value, key) => {
    serverResponse.setHeader(key, value);
  });

  if (!response.body) {
    serverResponse.end(Buffer.from(await response.arrayBuffer()));
    return;
  }

  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value || value.byteLength === 0) {
        continue;
      }

      const canContinue = serverResponse.write(Buffer.from(value));
      if (canContinue === false && serverResponse.once) {
        await new Promise<void>((resolve) => {
          serverResponse.once?.("drain", resolve);
        });
      }
    }
  } finally {
    reader.releaseLock();
  }

  serverResponse.end();
}
