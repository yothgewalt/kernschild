package main

import (
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type claims struct {
	Email string `json:"email"`
	jwt.RegisteredClaims
}

func issueToken(secret []byte, userID, email string, ttl time.Duration) (string, time.Time, error) {
	exp := time.Now().Add(ttl).UTC()
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims{
		Email:            email,
		RegisteredClaims: jwt.RegisteredClaims{Subject: userID, ExpiresAt: jwt.NewNumericDate(exp)},
	})
	s, err := t.SignedString(secret)
	return s, exp, err
}

// validateToken accepts only HS256 and requires an expiry.
func validateToken(secret []byte, token string) (*claims, error) {
	c := &claims{}
	_, err := jwt.ParseWithClaims(token, c, func(*jwt.Token) (any, error) { return secret, nil },
		jwt.WithValidMethods([]string{"HS256"}), jwt.WithExpirationRequired())
	if err != nil {
		return nil, err
	}
	return c, nil
}
