// Walks one booking through the whole flow: auth → event → booking (PENDING) → payment → final status.
import { must, newUser, sleep } from './lib.mjs';

const log = (label, value) => console.log(`\n== ${label}\n${JSON.stringify(value, null, 2)}`);

const user = await newUser('demo');
log('registered + logged in', { email: user.email, token: user.token.slice(0, 24) + '…' });

const { events } = await must('GET', '/events');
log('events', events);
const event = events[0];

const { booking } = await must('POST', '/bookings', { token: user.token, body: { event_id: event.id, quantity: 2 } });
log('booking created (seats held while payment runs)', booking);

let current = booking;
while (current.status === 'PENDING') {
  await sleep(1000);
  ({ booking: current } = await must('GET', `/bookings/${booking.id}`));
  console.log(`   … ${new Date().toISOString()} status=${current.status}`);
}
log('booking settled', current);
log('payment', (await must('GET', `/payments/${booking.id}`)).payment);
log('event after booking', (await must('GET', `/events/${event.id}`)).event);
log('stats', await must('GET', '/stats'));
