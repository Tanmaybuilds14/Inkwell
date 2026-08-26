import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest';
import { purgeExpiredTrash, pruneOldSnapshots } from '@/inngest/functions';
import { sendInviteEmail } from '@/inngest/invite';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [purgeExpiredTrash, pruneOldSnapshots, sendInviteEmail],
});
