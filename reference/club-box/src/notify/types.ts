export type Channel = "email" | "sms";
export type MessageKind = "transactional" | "marketing";

export type OutboundMessage = {
  channel: Channel;
  kind: MessageKind;
  to: string;
  subject: string | null;
  text: string;
};

/**
 * One club-owned sender. Providers do not decide consent.
 * Transactional and marketing sends go through `src/notify/service.ts`,
 * which is what checks opt-in.
 */
export interface MessageProvider {
  readonly id: string;
  readonly channel: Channel;
  send(message: OutboundMessage): Promise<{ id: string }>;
}

export type Notifier = {
  readonly email: MessageProvider;
  readonly sms: MessageProvider;
};
