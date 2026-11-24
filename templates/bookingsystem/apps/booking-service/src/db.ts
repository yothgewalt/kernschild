import pg from 'pg';
import type { Booking, BookingStatus } from './types.ts';

// Runs as one implicit transaction. The guarded upgrade from the auth-era schema comes first,
// so the email index below finds its column; on a fresh or already-upgraded database it does nothing.
const SCHEMA = `
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'bookings' AND column_name = 'user_id') THEN
    ALTER TABLE bookings RENAME COLUMN user_id TO email;
    ALTER TABLE bookings ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT '';
    ALTER INDEX IF EXISTS bookings_user_idx RENAME TO bookings_email_idx;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'idempotency_keys' AND column_name = 'user_id') THEN
    ALTER TABLE idempotency_keys RENAME COLUMN user_id TO email;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  name text NOT NULL,
  event_id uuid NOT NULL,
  quantity int NOT NULL,
  amount_cents bigint NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING','CONFIRMED','FAILED','EXPIRED')),
  payment_id uuid,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bookings_email_idx ON bookings (email);
CREATE INDEX IF NOT EXISTS bookings_status_exp_idx ON bookings (status, expires_at);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  email text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  booking_id uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (email, key)
);
CREATE INDEX IF NOT EXISTS idempotency_keys_created_idx ON idempotency_keys (created_at);`;

type BookingRow = Omit<Booking, 'amount_cents'> & { amount_cents: string }; // pg returns bigint as a string
const row = (r: BookingRow): Booking => ({ ...r, amount_cents: Number(r.amount_cents) });

export type NewBooking = Pick<Booking, 'id' | 'email' | 'name' | 'event_id' | 'quantity' | 'amount_cents'> & { expires_at: string };
export type Db = ReturnType<typeof createDb>;

export function createDb(url: string) {
  const pool = new pg.Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 5000 });
  const q = async <R extends pg.QueryResultRow>(sql: string, params?: unknown[]) => (await pool.query<R>(sql, params)).rows;
  return {
    init: () => pool.query(SCHEMA),
    ping: () => pool.query('SELECT 1'),
    close: () => pool.end(),
    async insert(b: NewBooking): Promise<void> {
      await pool.query(
        `INSERT INTO bookings (id,email,name,event_id,quantity,amount_cents,status,expires_at) VALUES ($1,$2,$3,$4,$5,$6,'PENDING',$7) ON CONFLICT (id) DO NOTHING`,
        [b.id, b.email, b.name, b.event_id, b.quantity, b.amount_cents, b.expires_at]);
    },
    // The only way a status changes. Returns true if this call made the transition.
    async transition(id: string, status: Exclude<BookingStatus, 'PENDING'>, paymentId: string | null = null): Promise<boolean> {
      const r = await pool.query(
        `UPDATE bookings SET status=$2, payment_id=COALESCE($3,payment_id), updated_at=now() WHERE id=$1 AND status='PENDING'`,
        [id, status, paymentId]);
      return r.rowCount === 1;
    },
    // Not a status change: records the payment on a booking that is already terminal.
    async setPaymentIdIfNull(id: string, paymentId: string): Promise<void> {
      await pool.query('UPDATE bookings SET payment_id=$2, updated_at=now() WHERE id=$1 AND payment_id IS NULL', [id, paymentId]);
    },
    // Stores the key on first use; returns the stored { request_hash, booking_id } (possibly another request's).
    async claimKey(email: string, key: string, requestHash: string, bookingId: string) {
      await pool.query('INSERT INTO idempotency_keys (email,key,request_hash,booking_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [email, key, requestHash, bookingId]);
      const [stored] = await q<{ request_hash: string; booking_id: string }>('SELECT request_hash, booking_id FROM idempotency_keys WHERE email=$1 AND key=$2', [email, key]);
      if (!stored) throw new Error('idempotency key vanished between insert and select'); // a concurrent rebind deleted it
      return stored;
    },
    // Unbinds the key only if it still points at bookingId, so concurrent retries rebind it once.
    async releaseKey(email: string, key: string, bookingId: string): Promise<void> {
      await pool.query('DELETE FROM idempotency_keys WHERE email=$1 AND key=$2 AND booking_id=$3', [email, key, bookingId]);
    },
    async deleteOldKeys() {
      return (await pool.query(`DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours'`)).rowCount;
    },
    // Marks overdue PENDING bookings EXPIRED; returns their ids.
    async listOverdue(): Promise<string[]> {
      return (await q<{ id: string }>(`SELECT id FROM bookings WHERE status='PENDING' AND expires_at <= now() LIMIT 1000`)).map((r) => r.id);
    },
    async get(id: string): Promise<Booking | undefined> {
      const [r] = await q<BookingRow>('SELECT * FROM bookings WHERE id=$1', [id]);
      return r && row(r);
    },
    async listByEmail(email: string): Promise<Booking[]> { return (await q<BookingRow>('SELECT * FROM bookings WHERE email=$1 ORDER BY created_at DESC', [email])).map(row); },
    async counts(): Promise<Record<BookingStatus, number>> {
      const out: Record<BookingStatus, number> = { PENDING: 0, CONFIRMED: 0, FAILED: 0, EXPIRED: 0 };
      for (const r of await q<{ status: BookingStatus; n: number }>('SELECT status, count(*)::int n FROM bookings GROUP BY status')) out[r.status] = r.n;
      return out;
    },
  };
}
