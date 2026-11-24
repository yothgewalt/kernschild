import amqp from 'amqplib';

const EXCHANGE = 'bookings';
export const RESULTS_QUEUE = 'booking.payment-results';

// Connects, declares the shared topology, returns { publish, consume, isOpen, close }.
export async function connectMq(url, onClose) {
  const conn = await amqp.connect(url);
  conn.on('error', () => {});
  conn.on('close', () => onClose?.());
  const pub = await conn.createConfirmChannel();
  pub.on('error', () => {});
  pub.on('close', () => onClose?.()); // a dead publish channel is as fatal as a dead connection
  await pub.assertExchange(EXCHANGE, 'topic', { durable: true });
  await pub.assertQueue('payment.requests', { durable: true });
  await pub.bindQueue('payment.requests', EXCHANGE, 'payment.requested');
  await pub.assertQueue(RESULTS_QUEUE, { durable: true });
  for (const k of ['payment.completed', 'payment.failed']) await pub.bindQueue(RESULTS_QUEUE, EXCHANGE, k);
  await pub.assertQueue('payment.refunds', { durable: true });
  await pub.bindQueue('payment.refunds', EXCHANGE, 'payment.refund.requested');
  let open = true;
  conn.on('close', () => { open = false; });
  return {
    isOpen: () => open,
    publish: (key, body) => new Promise((resolve, reject) =>
      pub.publish(EXCHANGE, key, Buffer.from(JSON.stringify(body)), { persistent: true, contentType: 'application/json' },
        (err) => (err ? reject(err) : resolve()))),
    // handler(body) resolves 'ack' | 'requeue'; unparsable or throwing messages are dropped.
    async consume(handler) {
      const ch = await conn.createChannel();
      ch.on('error', () => {});
      ch.on('close', () => onClose?.());
      await ch.prefetch(20);
      await ch.consume(RESULTS_QUEUE, async (msg) => {
        if (!msg) return;
        let verdict = 'drop';
        try { verdict = await handler(JSON.parse(msg.content.toString())); } catch (e) { console.error('result handler error', e.message); }
        if (verdict === 'ack') ch.ack(msg);
        else if (verdict === 'requeue') { await new Promise((r) => setTimeout(r, 1000)); ch.nack(msg, false, true); }
        else ch.nack(msg, false, false);
      });
    },
    close: async () => { open = false; await conn.close().catch(() => {}); },
  };
}
