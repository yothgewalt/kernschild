import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import type { MethodDefinition } from '@grpc/proto-loader';
import type { status as GrpcStatus } from '@grpc/grpc-js';
import type { ProtoGrpcType as AuthProto } from './gen/auth.ts';
import type { ProtoGrpcType as EventProto } from './gen/event.ts';
import type { ProtoGrpcType as PaymentProto } from './gen/payment.ts';
import type { AuthServiceDefinition } from './gen/bookingsystem/auth/v1/AuthService.ts';
import type { EventServiceDefinition } from './gen/bookingsystem/event/v1/EventService.ts';
import type { PaymentServiceDefinition } from './gen/bookingsystem/payment/v1/PaymentService.ts';
import type { config } from './config.ts';

const DEADLINE_MS = 5000;
const opts = { keepCase: true, longs: String, enums: String, defaults: true };
// A recreated container gets a new IP: re-resolve DNS after 1s (default 30s) and reconnect
// within ~2s (default backoff grows to 120s), so peer restarts heal in seconds.
const channelOpts = {
  'grpc.dns_min_time_between_resolutions_ms': 1000,
  'grpc.initial_reconnect_backoff_ms': 200,
  'grpc.max_reconnect_backoff_ms': 2000,
};

// The promise form of one unary RPC, typed from the generated service definition. Every request
// field is required: proto3 would send a missing one as its default ('' or 0) without complaint.
type Rpc<D, K extends keyof D> =
  D[K] extends MethodDefinition<infer Req, infer _Res, infer _ReqOut, infer Res> ? (req: Required<Req>) => Promise<Res> : never;
type Rpcs<D, K extends keyof D> = { [M in K]: Rpc<D, M> };

export interface Clients {
  auth: Rpcs<AuthServiceDefinition, 'Register' | 'Login' | 'ValidateToken'>;
  event: Rpcs<EventServiceDefinition, 'CreateEvent' | 'GetEvent' | 'ListEvents' | 'ReserveSeats' | 'ConfirmSeats' | 'ReleaseSeats'>;
  payment: Rpcs<PaymentServiceDefinition, 'GetPayment' | 'ListPayments'>;
}

function unary<Res>(start: (options: grpc.CallOptions, cb: grpc.requestCallback<Res>) => void): Promise<Res> {
  return new Promise((resolve, reject) =>
    // No waitForReady here: grpc-js reads it only from Metadata options and ignored it in CallOptions,
    // so calls to a down peer fail fast with UNAVAILABLE, as they always have.
    start({ deadline: Date.now() + DEADLINE_MS }, (err, res) => {
      if (err) reject(err);
      else if (res === undefined) reject(new Error('empty gRPC response'));
      else resolve(res);
    }));
}

// Each method is (req) => Promise<res>. Errors keep grpc `.code`.
export function createClients(cfg: typeof config): Clients {
  const files = ['auth', 'event', 'payment'].map((name) => `${cfg.protoDir}/bookingsystem/${name}/v1/${name}.proto`);
  // The one cast: loadPackageDefinition is untyped; the generated types describe what it loaded.
  const { auth, event, payment } = (grpc.loadPackageDefinition(protoLoader.loadSync(files, opts)) as unknown as
    AuthProto & EventProto & PaymentProto).bookingsystem;
  const insecure = () => grpc.credentials.createInsecure();
  const a = new auth.v1.AuthService(cfg.authAddr, insecure(), channelOpts);
  const e = new event.v1.EventService(cfg.eventAddr, insecure(), channelOpts);
  const p = new payment.v1.PaymentService(cfg.paymentAddr, insecure(), channelOpts);
  return {
    auth: {
      Register: (req) => unary((o, cb) => a.Register(req, o, cb)),
      Login: (req) => unary((o, cb) => a.Login(req, o, cb)),
      ValidateToken: (req) => unary((o, cb) => a.ValidateToken(req, o, cb)),
    },
    event: {
      CreateEvent: (req) => unary((o, cb) => e.CreateEvent(req, o, cb)),
      GetEvent: (req) => unary((o, cb) => e.GetEvent(req, o, cb)),
      ListEvents: (req) => unary((o, cb) => e.ListEvents(req, o, cb)),
      ReserveSeats: (req) => unary((o, cb) => e.ReserveSeats(req, o, cb)),
      ConfirmSeats: (req) => unary((o, cb) => e.ConfirmSeats(req, o, cb)),
      ReleaseSeats: (req) => unary((o, cb) => e.ReleaseSeats(req, o, cb)),
    },
    payment: {
      GetPayment: (req) => unary((o, cb) => p.GetPayment(req, o, cb)),
      ListPayments: (req) => unary((o, cb) => p.ListPayments(req, o, cb)),
    },
  };
}

export const code = grpc.status;
export type { GrpcStatus };

// The grpc status code of a thrown error, if it carries one.
export function grpcCode(e: unknown): GrpcStatus | undefined {
  const c = typeof e === 'object' && e !== null && 'code' in e ? e.code : undefined;
  return isGrpcStatus(c) ? c : undefined;
}
const isGrpcStatus = (c: unknown): c is GrpcStatus => typeof c === 'number' && c in grpc.status;
