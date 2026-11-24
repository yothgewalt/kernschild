import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';

const DEADLINE_MS = 5000;
const opts = { keepCase: true, longs: String, enums: String, defaults: true };

// Returns { auth, event, payment }, each method (req) => Promise<res>. Errors keep grpc `.code`.
export function createClients(cfg) {
  const load = (name, svc, addr) => {
    const def = protoLoader.loadSync(`${cfg.protoDir}/bookingsystem/${name}/v1/${name}.proto`, opts);
    const pkg = grpc.loadPackageDefinition(def).bookingsystem[name].v1;
    const client = new pkg[svc](addr, grpc.credentials.createInsecure());
    return new Proxy({}, {
      get: (_, method) => (req) => new Promise((resolve, reject) =>
        client[method](req, { deadline: Date.now() + DEADLINE_MS }, (err, res) => (err ? reject(err) : resolve(res)))),
    });
  };
  return {
    auth: load('auth', 'AuthService', cfg.authAddr),
    event: load('event', 'EventService', cfg.eventAddr),
    payment: load('payment', 'PaymentService', cfg.paymentAddr),
  };
}

export const code = grpc.status;
