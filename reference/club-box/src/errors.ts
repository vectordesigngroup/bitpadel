/** Expected client or webhook failure with an HTTP status. */
export class AppError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AppError";
    this.status = status;
  }
}

/**
 * LNURL-auth failure. Wallets display `reason` and expect HTTP 200,
 * so the server maps this to `{ status: "ERROR", reason }` rather than an HTTP error.
 */
export class LnurlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LnurlError";
  }
}

/** Upstream payment processor failed. The message is safe to show to the operator. */
export class PaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentError";
  }
}
