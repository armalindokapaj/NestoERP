/**
 * The mail contract (PRD #38 §10).
 *
 * Business code speaks in template keys and variables and never names a
 * provider. Providers speak in rendered messages and never know what a template
 * is. Nothing outside `lib/mail` imports a vendor.
 */

export const MAIL_TEMPLATE_KEYS = [
  "team.invitation",
  "team.invitation_resend",
  "company.owner_invitation",
  "collaboration.mention",
  "approval.requested",
  "document.review_requested",
  "hse.critical",
  "calendar.reminder",
  "meeting.invitation",
  "announcement.critical",
  "auth.password_reset",
  "auth.password_reset_completed",
  "auth.recovery_email_verify",
  "auth.recovery_email_changed",
] as const;

export type MailTemplateKey = (typeof MAIL_TEMPLATE_KEYS)[number];

export type MailMessage = {
  to: string;
  templateKey: MailTemplateKey;
  variables: Record<string, string>;
  /** The same key twice sends once (PRD #38 §155). */
  idempotencyKey?: string;
  companyId?: string | null;
  /** What the message is about, recorded on the delivery for operators. */
  entity?: { type: string; id: string };
};

export type RenderedMail = {
  subject: string;
  text: string;
  html: string;
};

/** What a provider is handed: already rendered, already addressed. */
export type ProviderMessage = RenderedMail & {
  to: string;
  from: string;
  idempotencyKey?: string;
};

export type MailDeliveryResult = {
  providerMessageId?: string;
  status: "SENT" | "FAILED";
  errorCode?: string;
  /** A network error or a 5xx is worth another attempt; a rejected address is not. */
  retryable?: boolean;
};

export interface MailProvider {
  readonly name: string;
  /** True for providers that never put a message on the wire. */
  readonly sink: boolean;
  send(message: ProviderMessage): Promise<MailDeliveryResult>;
}

export type MailOutcome = {
  deliveryId: string;
  status: "SENT" | "FAILED" | "SUPPRESSED";
  errorCode?: string;
};
