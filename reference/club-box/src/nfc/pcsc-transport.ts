import type { CardTransport } from "./program.js";

type PcscStatus = { state: number };

type PcscReader = {
  SCARD_STATE_PRESENT: number;
  SCARD_SHARE_SHARED: number;
  state: number;
  name: string;
  on(event: "status", cb: (status: PcscStatus) => void): void;
  connect(options: { share_mode: number }, cb: (err: Error | null, protocol: number) => void): void;
  transmit(data: Buffer, maxLength: number, protocol: number, cb: (err: Error | null, data: Buffer) => void): void;
  disconnect(disposition: number, cb: (err: Error | null) => void): void;
  close(): void;
};

type PcscLite = {
  on(event: "reader", cb: (reader: PcscReader) => void): void;
  on(event: "error", cb: (error: Error) => void): void;
  close(): void;
};

/**
 * PC/SC transport for a local reader such as an ACR122U-class device.
 * The pcsclite package is optional so the server and tests do not need pcscd.
 */
export async function openPcscTransport(): Promise<{ transport: CardTransport; close: () => Promise<void> }> {
  const specifier = "pcsclite";
  const loaded = (await import(specifier)) as { default?: () => PcscLite };
  const factory = loaded.default;
  if (!factory) throw new Error("Install the optional pcsclite package and pcscd to use a reader");
  const pcsc = factory();
  const reader = await new Promise<PcscReader>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("No PC/SC reader appeared")), 10_000);
    pcsc.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    pcsc.on("reader", (found) => {
      clearTimeout(timer);
      resolve(found);
    });
  });
  const protocol = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Place the card on the reader")), 30_000);
    reader.on("status", (status) => {
      if ((status.state & reader.SCARD_STATE_PRESENT) === 0) return;
      clearTimeout(timer);
      reader.connect({ share_mode: reader.SCARD_SHARE_SHARED }, (error, connected) => {
        if (error) reject(error);
        else resolve(connected);
      });
    });
  });
  const transport: CardTransport = {
    transceive(apdu) {
      return new Promise((resolve, reject) => {
        reader.transmit(apdu, 512, protocol, (error, data) => {
          if (error) reject(error);
          else resolve(data);
        });
      });
    },
  };
  return {
    transport,
    close: async () => {
      await new Promise<void>((resolve) => {
        reader.disconnect(0, () => resolve());
      });
      reader.close();
      pcsc.close();
    },
  };
}
