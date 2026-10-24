import QRCode from "qrcode";

export async function pngQr(text: string): Promise<Buffer> {
  return QRCode.toBuffer(text, {
    type: "png",
    width: 360,
    margin: 1,
    errorCorrectionLevel: "M",
  });
}
