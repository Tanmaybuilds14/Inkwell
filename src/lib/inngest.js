import { Inngest } from 'inngest';

export const inngest = new Inngest({
  id: 'inkwell',
  name: 'Inkwell',
  eventKey: process.env.INNGEST_EVENT_KEY,
});
