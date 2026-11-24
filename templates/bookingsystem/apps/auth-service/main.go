package main

import (
	"context"
	"errors"
	"log"
	"net"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	pb "auth-service/gen/bookingsystem/auth/v1"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/reflection"
	"google.golang.org/grpc/status"
)

type server struct {
	pb.UnimplementedAuthServiceServer
	db     *pgxpool.Pool
	secret []byte
	ttl    time.Duration
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func (s *server) Register(ctx context.Context, r *pb.RegisterRequest) (*pb.RegisterResponse, error) {
	email := strings.ToLower(strings.TrimSpace(r.Email))
	if !strings.Contains(email, "@") || len(r.Password) < 6 {
		return nil, status.Error(codes.InvalidArgument, "email must contain @ and password must be at least 6 chars")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(r.Password), bcrypt.DefaultCost)
	if err != nil { // also fires for passwords over 72 bytes
		return nil, status.Error(codes.InvalidArgument, "invalid password")
	}
	u := &pb.User{Email: email}
	var created time.Time
	err = s.db.QueryRow(ctx, `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, created_at`,
		email, string(hash)).Scan(&u.Id, &created)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return nil, status.Error(codes.AlreadyExists, "email already registered")
	}
	if err != nil {
		log.Printf("register: %v", err)
		return nil, status.Error(codes.Internal, "internal error")
	}
	u.CreatedAt = created.UTC().Format(time.RFC3339)
	log.Printf("registered user %s", u.Id)
	return &pb.RegisterResponse{User: u}, nil
}

func (s *server) Login(ctx context.Context, r *pb.LoginRequest) (*pb.LoginResponse, error) {
	bad := status.Error(codes.Unauthenticated, "invalid email or password")
	u := &pb.User{Email: strings.ToLower(strings.TrimSpace(r.Email))}
	var hash string
	var created time.Time
	err := s.db.QueryRow(ctx, `SELECT id, password_hash, created_at FROM users WHERE email = $1`, u.Email).
		Scan(&u.Id, &hash, &created)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, bad
	}
	if err != nil {
		log.Printf("login: %v", err)
		return nil, status.Error(codes.Internal, "internal error")
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(r.Password)) != nil {
		return nil, bad
	}
	u.CreatedAt = created.UTC().Format(time.RFC3339)
	tok, exp, err := issueToken(s.secret, u.Id, u.Email, s.ttl)
	if err != nil {
		return nil, status.Error(codes.Internal, "internal error")
	}
	log.Printf("login user %s", u.Id)
	return &pb.LoginResponse{Token: tok, ExpiresAt: exp.Format(time.RFC3339), User: u}, nil
}

func (s *server) ValidateToken(_ context.Context, r *pb.ValidateTokenRequest) (*pb.ValidateTokenResponse, error) {
	c, err := validateToken(s.secret, r.Token)
	if err != nil {
		return nil, status.Error(codes.Unauthenticated, "invalid token")
	}
	return &pb.ValidateTokenResponse{UserId: c.Subject, Email: c.Email}, nil
}

func connect(ctx context.Context, url string) (*pgxpool.Pool, error) {
	var err error
	for i := 1; i <= 30; i++ {
		var db *pgxpool.Pool
		if db, err = pgxpool.New(ctx, url); err == nil {
			if err = db.Ping(ctx); err == nil {
				return db, nil
			}
			db.Close()
		}
		log.Printf("postgres not ready (%d/30): %v", i, err)
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(time.Second):
		}
	}
	return nil, err
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(healthcheck(env("GRPC_ADDR", ":50051")))
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	ttl, err := time.ParseDuration(env("TOKEN_TTL", "24h"))
	if err != nil {
		log.Fatalf("TOKEN_TTL: %v", err)
	}
	db, err := connect(ctx, env("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/auth?sslmode=disable"))
	if err != nil {
		log.Fatalf("postgres: %v", err)
	}
	defer db.Close()
	_, err = db.Exec(ctx, `CREATE TABLE IF NOT EXISTS users (
		id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
		email text UNIQUE NOT NULL,
		password_hash text NOT NULL,
		created_at timestamptz DEFAULT now())`)
	if err != nil {
		log.Fatalf("create table: %v", err)
	}

	lis, err := net.Listen("tcp", env("GRPC_ADDR", ":50051"))
	if err != nil {
		log.Fatal(err)
	}
	g := grpc.NewServer()
	pb.RegisterAuthServiceServer(g, &server{db: db, secret: []byte(env("JWT_SECRET", "dev-only-secret-change-me")), ttl: ttl})
	healthpb.RegisterHealthServer(g, health.NewServer())
	reflection.Register(g)

	go func() { <-ctx.Done(); log.Print("shutting down"); g.GracefulStop() }()
	log.Printf("auth listening on %s", lis.Addr())
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
