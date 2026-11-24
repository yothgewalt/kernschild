// Walks one booking through the whole flow: event → booking (PENDING) → payment → final status.
import { must, newCustomer, sleep } from './lib.mjs';

const log = (label, value) => console.log(`\n== ${label}\n${JSON.stringify(value, null, 2)}`);

const customer = newCustomer('demo');
log('customer (no sign-up: just email + name)', customer);

const { events } = await must('GET', '/events');
log('events', events);
const event = events[0];

const { booking } = await must('POST', '/bookings', { body: { event_id: event.id, quantity: 2, ...customer } });
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
log("customer's bookings", (await must('GET', `/bookings?email=${encodeURIComponent(customer.email)}`)).bookings.map(({ id, status }) => ({ id, status })));
log('stats', await must('GET', '/stats'));
