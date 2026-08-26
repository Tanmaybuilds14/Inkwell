import { inngest } from '@/lib/inngest';
import { prisma } from '@/lib/prisma';

/**
 * Sends a share-invite email with automatic retries (Inngest handles backoff).
 * Email is sent via Resend when RESEND_API_KEY is configured; otherwise the
 * invite is logged so local dev works without an email provider.
 */
export const sendInviteEmail = inngest.createFunction(
  {
    id: 'send-invite-email',
    name: 'Send invite email',
    retries: 5,
    triggers: [{ event: 'inkwell/document.shared' }],
  },
  async ({ event, step }) => {
    const { documentId, inviteeEmail, inviterName, documentTitle, role, inviteType } = event.data;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const link =
      inviteType === 'link'
        ? event.data.url
        : `${appUrl}/documents/${documentId}`;

    await step.run('send-email', async () => {
      const subject = `${inviterName ?? 'Someone'} invited you to "${documentTitle}" on Inkwell`;
      const html = `
        <p>Hi,</p>
        <p><strong>${inviterName ?? 'Someone'}</strong> shared the document
        <strong>"${documentTitle}"</strong> with you as a <strong>${role.toLowerCase()}</strong>.</p>
        <p><a href="${link}">Open the document</a></p>
      `;

      if (!process.env.RESEND_API_KEY) {
        console.log(`[invite-email] (dev log) To: ${inviteeEmail} | ${subject} | ${link}`);
        return { delivered: false, reason: 'no_resend_api_key' };
      }

      const { Resend } = await import('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      const result = await resend.emails.send({
        from: process.env.EMAIL_FROM ?? 'Inkwell <onboarding@resend.dev>',
        to: inviteeEmail,
        subject,
        html,
      });
      return { delivered: true, id: result.data?.id };
    });

    // Keep a durable record that the invite went out.
    if (inviteType === 'email') {
      await step.run('mark-invited', async () => {
        await prisma.permission.updateMany({
          where: { documentId, invitedEmail: inviteeEmail },
          data: { invitedEmail: inviteeEmail },
        });
      });
    }

    return { ok: true };
  }
);
