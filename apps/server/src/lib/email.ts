import { Resend } from "resend";

export function createEmailClient(apiKey: string): Resend {
  return new Resend(apiKey);
}

export async function sendMagicLinkEmail(
  resend: Resend,
  from: string,
  to: string,
  link: string,
): Promise<void> {
  await resend.emails.send({
    from,
    to,
    subject: "Your Driftline sign-in link",
    html: `<p>Click below to sign in to Driftline. This link expires in 15 minutes and can only be used once.</p><p><a href="${link}">${link}</a></p>`,
  });
}
