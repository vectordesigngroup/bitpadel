// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { PaymentError } from "../errors.js";

export async function requestJson(
  url: string,
  init: { method: "GET" | "POST"; headers?: Record<string, string>; body?: unknown },
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method,
      headers: {
        accept: "application/json",
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new PaymentError("Payment backend did not respond");
  }
  const text = await response.text();
  if (!response.ok) {
    throw new PaymentError(`Payment backend returned HTTP ${response.status}`);
  }
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new PaymentError("Payment backend returned invalid JSON");
  }
}
