// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import QRCode from "qrcode";

export async function pngQr(text: string): Promise<Buffer> {
  return QRCode.toBuffer(text, {
    type: "png",
    width: 360,
    margin: 1,
    errorCorrectionLevel: "M",
  });
}
