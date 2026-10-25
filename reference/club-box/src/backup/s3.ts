// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { createHash, createHmac } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import type { S3Config } from "../config.js";
import type { BackupDestination, BackupLocation } from "./destination.js";

/** Path-style S3-compatible PUT and GET. No AWS SDK. */
export class S3BackupDestination implements BackupDestination {
  readonly id = "s3";

  constructor(
    private readonly config: S3Config,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async put(name: string, filePath: string): Promise<BackupLocation> {
    const key = objectKey(this.config.prefix, name);
    const body = readFileSync(filePath);
    await signedS3Request(this.config, "PUT", key, body, this.fetchImpl);
    return { location: `s3://${this.config.bucket}/${key}` };
  }

  async get(name: string, destPath: string): Promise<void> {
    const key = objectKey(this.config.prefix, name);
    const bytes = await signedS3Request(this.config, "GET", key, null, this.fetchImpl);
    writeFileSync(destPath, bytes);
  }
}

export function objectKey(prefix: string, name: string): string {
  const base = name.split("/").pop() ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(base)) throw new Error("Backup name is invalid");
  const cleanPrefix = prefix.replace(/^\/+|\/+$/g, "");
  return cleanPrefix ? `${cleanPrefix}/${base}` : base;
}

export async function signedS3Request(
  config: S3Config,
  method: "GET" | "PUT",
  key: string,
  body: Buffer | null,
  fetchImpl: typeof fetch,
): Promise<Buffer> {
  const endpoint = new URL(config.endpoint);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payload = body ?? Buffer.alloc(0);
  const payloadHash = sha256(payload);
  const canonicalUri = `/${encodeURIComponent(config.bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const canonicalHeaders = `host:${endpoint.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = `${method}\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonicalRequest)}`;
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.secretKey}`, dateStamp), config.region), "s3"),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  const response = await fetchImpl(`${endpoint.origin}${canonicalUri}`, {
    method,
    headers: {
      authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    },
    body: method === "PUT" ? payload : undefined,
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Backup destination returned HTTP ${response.status}`);
  if (method === "GET") return Buffer.from(await response.arrayBuffer());
  return Buffer.alloc(0);
}

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}
