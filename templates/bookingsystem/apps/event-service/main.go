package main

import (
	"context"
	"log"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	pb "event-service/gen/bookingsystem/event/v1"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/reflection"
)

func logf(f string, a ...any) { log.Printf(f, a...) }

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func envDur(k, def string) time.Duration {
	d, err := time.ParseDuration(env(k, def))
	if err != nil || d <= 0 {
		log.Fatalf("bad %s: %v", k, err)
	}
	return d
}

func connect(ctx context.Context, url string) *pgxpool.Pool {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		log.Fatal(err)
	}
	cfg.MaxConns = 20 // bounded pool is the backpressure under bursts
	for i := 1; ; i++ {
		pool, err := pgxpool.NewWithConfig(ctx, cfg)
		if err == nil {
			if err = pool.Ping(ctx); err == nil {
				return pool
			}
			pool.Close()
		}
		if i >= 30 {
			log.Fatalf("postgres unavailable: %v", err)
		}
		logf("waiting for postgres (%d/30): %v", i, err)
		time.Sleep(time.Second)
	}
}

func connectRedis(ctx context.Context, url string) *redis.Client {
	opt, err := redis.ParseURL(url)
	if err != nil {
		log.Fatal(err)
	}
	rdb := redis.NewClient(opt)
	for i := 1; ; i++ {
		if err = rdb.Ping(ctx).Err(); err == nil {
			return rdb
		}
		if i >= 30 {
			log.Fatalf("redis unavailable: %v", err)
		}
		logf("waiting for redis (%d/30): %v", i, err)
		time.Sleep(time.Second)
	}
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(healthcheck(env("GRPC_ADDR", ":50052")))
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool := connect(ctx, env("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/event?sslmode=disable"))
	defer pool.Close()
	rdb := connectRedis(ctx, env("REDIS_URL", "redis://localhost:6379/0"))
	defer rdb.Close()
	st := &Store{pool: pool, rdb: rdb, ttl: envDur("HOLD_TTL", "15s")}
	if err := st.Init(ctx); err != nil {
		log.Fatalf("init: %v", err)
	}

	interval := envDur("SWEEP_INTERVAL", "1s")
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				n, err := st.Sweep(ctx)
				if err != nil && ctx.Err() == nil {
					logf("sweep error: %v", err)
				} else if n > 0 {
					logf("sweeper released %d expired holds", n)
				}
			}
		}
	}()

	addr := env("GRPC_ADDR", ":50052")
	lis, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatal(err)
	}
	g := grpc.NewServer()
	pb.RegisterEventServiceServer(g, &server{st: st})
	h := health.NewServer()
	healthpb.RegisterHealthServer(g, h)
	reflection.Register(g)
	go func() { <-ctx.Done(); logf("shutting down"); g.GracefulStop() }()
	logf("event service listening on %s (hold ttl %s)", addr, st.ttl)
	if err := g.Serve(lis); err != nil {
		log.Fatal(err)
	}
}

// healthcheck backs the compose healthcheck (distroless has no shell): exit 0 when the gRPC health service reports SERVING.
func healthcheck(addr string) int {
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		return 1
	}
	conn, err := grpc.NewClient("localhost:"+port, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return 1
	}
	defer conn.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	r, err := healthpb.NewHealthClient(conn).Check(ctx, &healthpb.HealthCheckRequest{})
	if err != nil || r.Status != healthpb.HealthCheckResponse_SERVING {
		return 1
	}
	return 0
}
