export { latestDeliveryFor, mailProvider, recipientAllowed, sendMail, setMailProvider } from "./mail.service";
export { clearOutbox, readOutbox, type SentMail } from "./providers";
export { renderMailTemplate } from "./templates";
export type { MailMessage, MailOutcome, MailProvider, MailTemplateKey } from "./mail.types";
