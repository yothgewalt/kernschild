package main

import (
	"testing"
	"time"
)

func TestTokenRoundTrip(t *testing.T) {
	secret := []byte("s")
	tok, _, err := issueToken(secret, "u1", "a@b.c", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	c, err := validateToken(secret, tok)
	if err != nil || c.Subject != "u1" || c.Email != "a@b.c" {
		t.Fatalf("got %+v, %v", c, err)
	}
}

func TestTokenRejected(t *testing.T) {
	secret := []byte("s")
	good, _, _ := issueToken(secret, "u1", "a@b.c", time.Minute)
	expired, _, _ := issueToken(secret, "u1", "a@b.c", -time.Minute)
	cases := map[string]string{
		"tampered":     good[:len(good)-2] + "xx",
		"wrong secret": func() string { s, _, _ := issueToken([]byte("other"), "u1", "a@b.c", time.Minute); return s }(),
		"expired":      expired,
		"garbage":      "nope",
		"empty":        "",
	}
	for name, tok := range cases {
		if _, err := validateToken(secret, tok); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}
