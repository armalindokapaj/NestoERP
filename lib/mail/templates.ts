import type { MailTemplateKey, RenderedMail } from "./mail.types";

/**
 * Email templates (PRD #38 §11, §162).
 *
 * What an email may carry is deliberately narrow: who did what, where, and a
 * link back into NESTO. Never a password, never a signed storage URL, never the
 * text of a comment or a confidential record — the link leads to the
 * application, and the application decides again, at the moment it is opened,
 * whether this person may still see what is behind it.
 *
 * Every variable is escaped for HTML. Links must be absolute application URLs,
 * built from configuration rather than from a request (`lib/config/app-url.ts`).
 */

type TemplateDefinition = {
  /** Variables the caller must supply; a missing one is a programming error. */
  variables: readonly string[];
  /** The variable holding the call-to-action link. */
  linkVariable: string;
  subject: (v: Record<string, string>) => string;
  heading: (v: Record<string, string>) => string;
  paragraphs: (v: Record<string, string>) => string[];
  action: (v: Record<string, string>) => string;
  footnote: (v: Record<string, string>) => string;
};

const TEMPLATES: Record<MailTemplateKey, TemplateDefinition> = {
  "team.invitation": {
    variables: ["inviterName", "companyName", "acceptUrl", "expiresInDays"],
    linkVariable: "acceptUrl",
    subject: (v) => `${v.inviterName} invited you to ${v.companyName} on NESTO`,
    heading: (v) => `Join ${v.companyName} on NESTO`,
    paragraphs: (v) => [
      `${v.inviterName} has invited you to join ${v.companyName} on NESTO.`,
      `The invitation expires in ${v.expiresInDays} days and can only be used once.`,
    ],
    action: () => "Accept the invitation",
    footnote: () => "If you were not expecting this, you can ignore this message.",
  },
  "team.invitation_resend": {
    variables: ["inviterName", "companyName", "acceptUrl", "expiresInDays"],
    linkVariable: "acceptUrl",
    subject: (v) => `Your invitation to ${v.companyName} on NESTO`,
    heading: (v) => `Join ${v.companyName} on NESTO`,
    paragraphs: (v) => [
      `${v.inviterName} sent your invitation to ${v.companyName} again.`,
      `Any earlier invitation link no longer works. This one expires in ${v.expiresInDays} days.`,
    ],
    action: () => "Accept the invitation",
    footnote: () => "If you were not expecting this, you can ignore this message.",
  },
  "company.owner_invitation": {
    variables: ["companyName", "acceptUrl", "expiresInDays"],
    linkVariable: "acceptUrl",
    subject: (v) => `${v.companyName} is ready on NESTO`,
    heading: (v) => `${v.companyName} is ready`,
    paragraphs: (v) => [
      `A NESTO workspace has been created for ${v.companyName}, with you as its Owner.`,
      `Set your password to sign in. The link expires in ${v.expiresInDays} days and can only be used once.`,
    ],
    action: () => "Set up your account",
    footnote: () => "If you were not expecting this, contact the person who set up the workspace.",
  },
  "collaboration.mention": {
    variables: ["actorName", "recordLabel", "link"],
    linkVariable: "link",
    subject: (v) => `${v.actorName} mentioned you on ${v.recordLabel}`,
    heading: () => "You were mentioned",
    paragraphs: (v) => [`${v.actorName} mentioned you in a comment on ${v.recordLabel}.`],
    action: () => "Open in NESTO",
    footnote: () => "You are receiving this because email is on for mentions in your notification settings.",
  },
  "approval.requested": {
    variables: ["title", "link"],
    linkVariable: "link",
    subject: (v) => v.title,
    heading: () => "Approval requested",
    paragraphs: (v) => [`${v.title}.`, "Open NESTO to review it."],
    action: () => "Review in NESTO",
    footnote: () => "You are receiving this because email is on for approvals in your notification settings.",
  },
  "document.review_requested": {
    variables: ["requesterName", "documentName", "link"],
    linkVariable: "link",
    subject: (v) => `${v.requesterName} asked you to review ${v.documentName}`,
    heading: () => "Document review requested",
    paragraphs: (v) => [`${v.requesterName} asked you to review “${v.documentName}”.`],
    action: () => "Review in NESTO",
    footnote: () => "You are receiving this because email is on for documents in your notification settings.",
  },
  "hse.critical": {
    variables: ["title", "link"],
    linkVariable: "link",
    subject: (v) => `Critical HSE alert: ${v.title}`,
    heading: () => "Critical HSE alert",
    paragraphs: (v) => [`${v.title}.`, "Open NESTO for the details and the actions required."],
    action: () => "Open in NESTO",
    footnote: () => "Critical safety alerts are sent to everyone responsible, by company policy.",
  },
  "calendar.reminder": {
    variables: ["title", "when", "link"],
    linkVariable: "link",
    subject: (v) => `Reminder: ${v.title}`,
    heading: () => "Coming up",
    paragraphs: (v) => [`“${v.title}” starts ${v.when}.`],
    action: () => "Open in NESTO",
    footnote: () => "You are receiving this because email is on for calendar reminders in your notification settings.",
  },
  // Account recovery (ADM-01). Sent only to a verified recovery address, or —
  // for verification — to the address being proven. Never the password.
  "auth.password_reset": {
    variables: ["firstName", "resetUrl", "expiresInMinutes"],
    linkVariable: "resetUrl",
    subject: () => "Reset your NESTO password",
    heading: () => "Reset your password",
    paragraphs: (v) => [
      `Hello ${v.firstName},`,
      `Use the link below to choose a new password. It expires in ${v.expiresInMinutes} minutes and can only be used once.`,
    ],
    action: () => "Choose a new password",
    footnote: () => "If you didn't ask for this, you can ignore this message. Your password has not changed.",
  },
  "auth.password_reset_completed": {
    variables: ["firstName", "loginUrl"],
    linkVariable: "loginUrl",
    subject: () => "Your NESTO password was reset",
    heading: () => "Your password was reset",
    paragraphs: (v) => [
      `Hello ${v.firstName},`,
      "The password of your NESTO account was just reset from a recovery link, and every session was signed out.",
    ],
    action: () => "Sign in",
    footnote: () => "If this wasn't you, contact your NESTO platform administrator at once.",
  },
  "auth.recovery_email_verify": {
    variables: ["firstName", "verifyUrl", "expiresInMinutes"],
    linkVariable: "verifyUrl",
    subject: () => "Confirm your NESTO recovery email",
    heading: () => "Confirm your recovery email",
    paragraphs: (v) => [
      `Hello ${v.firstName},`,
      `Confirm that this address may receive password-recovery links for your NESTO account. The link expires in ${v.expiresInMinutes} minutes.`,
    ],
    action: () => "Confirm this address",
    footnote: () => "If you didn't ask for this, ignore this message; nothing changes until the link is used.",
  },
  "auth.recovery_email_changed": {
    variables: ["firstName", "loginUrl"],
    linkVariable: "loginUrl",
    subject: () => "Your NESTO recovery email changed",
    heading: () => "Your recovery email changed",
    paragraphs: (v) => [
      `Hello ${v.firstName},`,
      "Password-recovery links for your NESTO account now go to a different address, and no longer to this one.",
    ],
    action: () => "Open NESTO",
    footnote: () => "If this wasn't you, contact your NESTO platform administrator at once.",
  },
  "announcement.critical": {
    variables: ["title", "link"],
    linkVariable: "link",
    subject: (v) => `Critical announcement: ${v.title}`,
    heading: () => "Critical announcement",
    paragraphs: (v) => [`“${v.title}”.`, "Open NESTO to read it and, where asked, confirm you have read it."],
    action: () => "Read in NESTO",
    footnote: () => "Critical announcements are sent to everyone they are addressed to, by company policy.",
  },
  "meeting.invitation": {
    variables: ["title", "when", "link"],
    linkVariable: "link",
    subject: (v) => `Invitation: ${v.title}`,
    heading: () => "You are invited to a meeting",
    paragraphs: (v) => [`“${v.title}”, ${v.when}.`, "Open NESTO to see the agenda and reply."],
    action: () => "Open the meeting",
    footnote: () => "You are receiving this because email is on for meetings in your notification settings.",
  },
};

export class MailTemplateError extends Error {}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Links are application URLs only — a template never carries a script or a data URL. */
function assertSafeLink(link: string): void {
  if (!/^https?:\/\//.test(link)) {
    throw new MailTemplateError("A mail link must be an absolute http(s) URL.");
  }
}

export function renderMailTemplate(
  templateKey: MailTemplateKey,
  variables: Record<string, string>,
): RenderedMail {
  const template = TEMPLATES[templateKey];
  if (!template) throw new MailTemplateError(`Unknown mail template: ${templateKey}`);

  const missing = template.variables.filter((name) => typeof variables[name] !== "string");
  if (missing.length > 0) {
    throw new MailTemplateError(`Template ${templateKey} is missing: ${missing.join(", ")}`);
  }

  const link = variables[template.linkVariable];
  assertSafeLink(link);

  const subject = template.subject(variables).replace(/[\r\n]+/g, " ");
  const heading = template.heading(variables);
  const paragraphs = template.paragraphs(variables);
  const action = template.action(variables);
  const footnote = template.footnote(variables);

  const text = [heading, "", ...paragraphs.flatMap((p) => [p, ""]), `${action}: ${link}`, "", footnote].join(
    "\n",
  );

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1c1b19;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e4e2dc;border-radius:12px;padding:32px;">
          <tr><td style="font-size:13px;letter-spacing:0.08em;font-weight:600;color:#6b6860;">NESTO</td></tr>
          <tr><td style="padding-top:16px;font-size:20px;font-weight:600;">${escapeHtml(heading)}</td></tr>
          ${paragraphs
            .map((p) => `<tr><td style="padding-top:12px;font-size:15px;line-height:1.5;">${escapeHtml(p)}</td></tr>`)
            .join("\n          ")}
          <tr><td style="padding-top:24px;">
            <a href="${escapeHtml(link)}" style="display:inline-block;background:#1c1b19;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px;">${escapeHtml(action)}</a>
          </td></tr>
          <tr><td style="padding-top:24px;font-size:13px;line-height:1.5;color:#6b6860;">${escapeHtml(footnote)}</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

export function mailTemplateKeys(): MailTemplateKey[] {
  return Object.keys(TEMPLATES) as MailTemplateKey[];
}

export function mailTemplateVariables(templateKey: MailTemplateKey): readonly string[] {
  return TEMPLATES[templateKey].variables;
}
