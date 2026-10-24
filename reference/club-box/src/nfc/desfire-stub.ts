import { AppError } from "../errors.js";

export type DesfirePersonalizeInput = {
  uid: string;
};

/**
 * DESFire personalization needs a reader and card keys on a bench machine.
 * This interface is the extension point. The shipped class does not program cards.
 * NTAG 424 DNA programming remains `npm run card:program`.
 */
export interface DesfirePersonalizer {
  personalize(input: DesfirePersonalizeInput): Promise<{ ok: true }>;
}

export class UnimplementedDesfirePersonalizer implements DesfirePersonalizer {
  async personalize(_input: DesfirePersonalizeInput): Promise<{ ok: true }> {
    throw new AppError(
      501,
      "DESFire personalization is not implemented. This build programs NTAG 424 DNA only. A reader bridge for DESFire is also not implemented.",
    );
  }
}

export type DesfireProof = {
  uid: string;
  counter: number;
  macHex: string;
};

/** A future reader process would return a proof the server already knows how to check. */
export interface DesfireReaderBridge {
  readProof(): Promise<DesfireProof>;
}

export class UnimplementedDesfireReaderBridge implements DesfireReaderBridge {
  async readProof(): Promise<DesfireProof> {
    throw new AppError(
      501,
      "DESFire reader bridge is not implemented. The NDEF bridge reads NTAG 424 URLs only.",
    );
  }
}
