/**
 * Mail transport (PRD #9 §224).
 *
 * V0.1 has no configured mail provider, so the default transport records the
 * message instead of sending it: development prints it, tests capture it, and
 * no automated run can ever put a real message on the wire.
 *
 * Wiring a provider means replacing `deliver` — nothing else in the codebase
 * knows how mail leaves the building.
 */
export type MailMessage = {
  to: string;
  subject: string;
  body: string;
};

type Transport = (message: MailMessage) => Promise<void>;

const outbox: MailMessage[] = [];

const logTransport: Transport = async (message) => {
  outbox.push(message);
  if (process.env.NODE_ENV === "development") {
    console.info(`[mail] ${message.subject} → ${message.to}\n${message.body}`);
  }
};

let transport: Transport = logTransport;

export function setMailTransport(next: Transport): void {
  transport = next;
}

export async function sendMail(message: MailMessage): Promise<void> {
  await transport(message);
}

/** Messages captured by the default transport, for tests and local debugging. */
export function readOutbox(): readonly MailMessage[] {
  return outbox;
}

export function clearOutbox(): void {
  outbox.length = 0;
}
