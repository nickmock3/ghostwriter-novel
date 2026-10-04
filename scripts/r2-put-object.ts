import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

export type R2UploadEnv = {
  accountId: string;
  accessKeyId: string;
  bucket: string;
  secretAccessKey: string;
};

export function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function readR2UploadEnv(): R2UploadEnv {
  return {
    accountId: readRequiredEnv("CLOUDFLARE_ACCOUNT_ID"),
    accessKeyId: readRequiredEnv("R2_ACCESS_KEY_ID"),
    bucket: readRequiredEnv("R2_BUCKET"),
    secretAccessKey: readRequiredEnv("R2_SECRET_ACCESS_KEY"),
  };
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function sha256Hex(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toAmzDate(date: Date): { dateStamp: string; timestamp: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    dateStamp: iso.slice(0, 8),
    timestamp: iso,
  };
}

function encodeObjectPath(bucket: string, objectKey: string): string {
  return `/${[bucket, ...objectKey.split("/")].map(encodeURIComponent).join("/")}`;
}

function createSignedPutRequest(
  env: R2UploadEnv,
  objectKey: string,
  body: Buffer,
  contentType: string,
): {
  headers: Record<string, string>;
  url: string;
} {
  const region = "auto";
  const service = "s3";
  const { dateStamp, timestamp } = toAmzDate(new Date());
  const host = `${env.accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = encodeObjectPath(env.bucket, objectKey);
  const url = `https://${host}${canonicalUri}`;
  const payloadHash = sha256Hex(body);
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = [
    `content-type:${contentType}`,
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${timestamp}`,
    "",
  ].join("\n");
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    timestamp,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const dateKey = hmac(`AWS4${env.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, service);
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  return {
    headers: {
      Authorization: `AWS4-HMAC-SHA256 Credential=${env.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "Content-Type": contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": timestamp,
    },
    url,
  };
}

export async function putR2Object(options: {
  contentType: string;
  env?: R2UploadEnv;
  filePath: string;
  objectKey: string;
}): Promise<void> {
  const env = options.env ?? readR2UploadEnv();
  const body = readFileSync(options.filePath);
  const request = createSignedPutRequest(env, options.objectKey, body, options.contentType);
  const response = await fetch(request.url, {
    body,
    headers: request.headers,
    method: "PUT",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to upload ${options.objectKey} to R2: ${response.status} ${text}`);
  }
}

async function runCli(argv: string[]): Promise<void> {
  const keyArgIndex = argv.findIndex((arg) => arg === "--key");
  const fileArgIndex = argv.findIndex((arg) => arg === "--file");
  const contentTypeArgIndex = argv.findIndex((arg) => arg === "--content-type");
  const objectKey = argv[keyArgIndex + 1];
  const filePath = argv[fileArgIndex + 1];
  const contentType = argv[contentTypeArgIndex + 1] ?? "application/octet-stream";
  if (!objectKey || !filePath) {
    throw new Error("Usage: bun run scripts/r2-put-object.ts --key <object-key> --file <path> [--content-type <type>]");
  }

  await putR2Object({ contentType, filePath, objectKey });
  console.log(`Uploaded ${objectKey}`);
}

if (import.meta.main) {
  void runCli(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
