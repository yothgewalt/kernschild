import pg from 'pg';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  event_id uuid NOT NULL,
  quantity int NOT NULL,
  amount_cents bigint NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING','CONFIRMED','FAILED','EXPIRED')),
  payment_id uuid,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bookings_user_idx ON bookings (user_id);
CREATE INDEX IF NOT EXISTS bookings_status_exp_idx ON bookings (status, expires_at);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  booking_id uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
CREATE INDEX IF NOT EXISTS idempotency_keys_created_idx ON idempotency_keys (created_at);`;

const row = (r) => r && { ...r, amount_cents: Number(r.amount_cents) };

export function createDb(url) {
  const pool = new pg.Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 5000 });
  const q = async (sql, params) => (await pool.query(sql, params)).rows;
  return {
    init: () => pool.query(SCHEMA),
    ping: () => pool.query('SELECT 1'),
    close: () => pool.end(),
    async insert(b) {
      await pool.query(
        `INSERT INTO bookings (id,user_id,event_id,quantity,amount_cents,status,expires_at) VALUES ($1,$2,$3,$4,$5,'PENDING',$6) ON CONFLICT (id) DO NOTHING`,
        [b.id, b.user_id, b.event_id, b.quantity, b.amount_cents, b.expires_at]);
    },
    // The only way a status changes. Returns true if this call made the transition.
    async transition(id, status, paymentId = null) {
      const r = await pool.query(
        `UPDATE bookings SET status=$2, payment_id=COALESCE($3,payment_id), updated_at=now() WHERE id=$1 AND status='PENDING'`,
        [id, status, paymentId]);
      return r.rowCount === 1;
    },
    // Not a status change: records the payment on a booking that is already terminal.
    async setPaymentIdIfNull(id, paymentId) {
      await pool.query('UPDATE bookings SET payment_id=$2, updated_at=now() WHERE id=$1 AND payment_id IS NULL', [id, paymentId]);
    },
    // Stores the key on first use; returns the stored { request_hash, booking_id } (possibly another request's).
    async claimKey(userId, key, requestHash, bookingId) {
      await pool.query('INSERT INTO idempotency_keys (user_id,key,request_hash,booking_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [userId, key, requestHash, bookingId]);
      return (await q('SELECT request_hash, booking_id FROM idempotency_keys WHERE user_id=$1 AND key=$2', [userId, key]))[0];
    },
    // Unbinds the key only if it still points at bookingId, so concurrent retries rebind it once.
    async releaseKey(userId, key, bookingId) {
      await pool.query('DELETE FROM idempotency_keys WHERE user_id=$1 AND key=$2 AND booking_id=$3', [userId, key, bookingId]);
    },
    async deleteOldKeys() {
      return (await pool.query(`DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours'`)).rowCount;
    },
    // Marks overdue PENDING bookings EXPIRED; returns their ids.
    async expireOverdue() {
      return (await q(`UPDATE bookings SET status='EXPIRED', updated_at=now() WHERE status='PENDING' AND expires_at <= now() RETURNING id`)).map((r) => r.id);
    },
    async get(id) { return row((await q('SELECT * FROM bookings WHERE id=$1', [id]))[0]); },
    async listByUser(userId) { return (await q('SELECT * FROM bookings WHERE user_id=$1 ORDER BY created_at DESC', [userId])).map(row); },
    async counts() {
      const out = { PENDING: 0, CONFIRMED: 0, FAILED: 0, EXPIRED: 0 };
      for (const r of await q('SELECT status, count(*)::int n FROM bookings GROUP BY status')) out[r.status] = r.n;
      return out;
    },
  };
}
