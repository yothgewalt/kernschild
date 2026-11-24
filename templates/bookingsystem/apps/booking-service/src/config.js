import { fileURLToPath } from 'node:url';
const e = process.env;
export const config = {
  port: Number(e.HTTP_PORT ?? 3000),
  databaseUrl: e.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/booking',
  rabbitUrl: e.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672/',
  authAddr: e.AUTH_ADDR ?? 'localhost:50051',
  eventAddr: e.EVENT_ADDR ?? 'localhost:50052',
  paymentAddr: e.PAYMENT_ADDR ?? 'localhost:50053',
  sweepMs: Number(e.SWEEP_INTERVAL_MS ?? 1000),
  protoDir: e.PROTO_DIR ?? fileURLToPath(new URL('../proto', import.meta.url)),
};
