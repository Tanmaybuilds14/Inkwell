import { Inngest } from 'inngest';

export const inngest = new Inngest({
  id: 'inkwell',
  name: 'Inkwell',
  eventKey: process.env.INGEST_EVENT_KEY,
});
