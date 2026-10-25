// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import type { AppConfig } from "../config.js";
import { BtcpayPaymentBackend } from "./btcpay.js";
import { LnbitsPaymentBackend } from "./lnbits.js";
import { MockPaymentBackend } from "./mock.js";
import type { PaymentBackend } from "./types.js";

export function createPaymentBackend(config: AppConfig): PaymentBackend {
  switch (config.paymentBackend) {
    case "mock":
      return new MockPaymentBackend(config);
    case "btcpay": {
      if (!config.btcpay) throw new Error("BTCPay is not configured");
      return new BtcpayPaymentBackend(config.btcpay);
    }
    case "lnbits": {
      if (!config.lnbits || config.satsPerMinorUnit == null) throw new Error("LNbits is not configured");
      return new LnbitsPaymentBackend(config.lnbits, config.satsPerMinorUnit);
    }
    default: {
      const unknown: never = config.paymentBackend;
      throw new Error(`Unknown payment backend: ${String(unknown)}`);
    }
  }
}
