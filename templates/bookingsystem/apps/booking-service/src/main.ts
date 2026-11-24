import { config } from './config.ts';
import { createClients } from './grpc.ts';
import { createDb } from './db.ts';
import { connectMq } from './mq.ts';
import { createBookings } from './bookings.ts';
import { buildApp } from './app.ts';
import { errorMessage } from './types.ts';

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

async function retry<T>(name: string, fn: () => Promise<T>, tries = 30): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= tries) throw e;
      log(`${name} not ready (${i}/${tries}): ${errorMessage(e)}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

let stopping = false;
const db = createDb(config.databaseUrl);
await retry('postgres', () => db.init());
// A lost broker connection is fatal: exit so the container restarts and reconnects.
const mq = await retry('rabbitmq', () => connectMq(config.rabbitUrl, () => { log('rabbitmq closed'); if (!stopping) process.exit(1); }));

const grpc = createClients(config); // lazy connect: dependencies being down is fine
const bookings = createBookings({ db, grpc, mq });
await mq.consume((msg) => bookings.onResult(msg));

const sweeper = setInterval(() => bookings.sweep().catch((e: unknown) => log('sweep error', errorMessage(e))), config.sweepMs);
const app = buildApp({ grpc, db, bookings, healthy: async () => { await db.ping(); return mq.isOpen(); } });
await app.listen({ port: config.port, host: '0.0.0.0' });
log(`booking listening on :${config.port}`);

async function shutdown() {
  stopping = true;
  log('shutting down');
  clearInterval(sweeper);
  await app.close();
  await mq.close();
  await db.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
