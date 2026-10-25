import type { AppConfig, CardProviderName } from "../../config.js";
import { SquareCardProvider } from "./square.js";
import { StripeCardProvider } from "./stripe.js";
import type { CardProvider } from "./types.js";

export type CardSet = {
  readonly names: CardProviderName[];
  get(name: CardProviderName): CardProvider | null;
};

export function createCardSet(config: AppConfig): CardSet {
  const providers = new Map<CardProviderName, CardProvider>();
  for (const name of config.cardProviders) {
    switch (name) {
      case "stripe": {
        if (!config.stripe) throw new Error("Stripe is not configured");
        providers.set(name, new StripeCardProvider(config.stripe));
        break;
      }
      case "square": {
        if (!config.square) throw new Error("Square is not configured");
        providers.set(name, new SquareCardProvider(config.square));
        break;
      }
      default: {
        const unknown: never = name;
        throw new Error(`Unknown card provider: ${String(unknown)}`);
      }
    }
  }
  return {
    names: config.cardProviders,
    get(name: CardProviderName): CardProvider | null {
      return providers.get(name) ?? null;
    },
  };
}
