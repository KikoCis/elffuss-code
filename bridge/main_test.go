package main

import "testing"

// Los orígenes son exactos: el nombre actual, los dos anteriores mientras dure
// el cambio de dominio y localhost de desarrollo. Nada por sufijo.
func TestAllowedOrigins(t *testing.T) {
	cases := []struct {
		origin string
		want   bool
	}{
		{"https://code.elffuss.com", true},
		{"https://code.elffuss.utopiaia.com", true},
		{"https://elffuss-code.utopiaia.com", true},
		{"http://localhost:8799", true},
		{"http://127.0.0.1:8799", true},

		{"", false},
		{"null", false},
		{"http://code.elffuss.com", false},
		{"https://code.elffuss.com:443", false},
		{"https://code.elffuss.com/", false},
		{"https://claw.elffuss.com", false},
		{"https://elffuss.com", false},
		{"https://git.elffuss.com", false},
		{"https://evil.code.elffuss.com", false},
		{"https://code.elffuss.com.evil.net", false},
		{"https://claw.elffuss.utopiaia.com", false},
		{"https://elffuss-claw.utopiaia.com", false},
		{"https://utopiaia.com", false},
		{"https://otra.utopiaia.com", false},
		{"http://localhost:8642", false},
		{"http://localhost", false},
	}
	for _, c := range cases {
		if got := allowedOrigins[c.origin]; got != c.want {
			t.Errorf("allowedOrigins[%q] = %v, want %v", c.origin, got, c.want)
		}
	}
}

func TestHostIsLoopback(t *testing.T) {
	cases := []struct {
		host string
		want bool
	}{
		{"127.0.0.1:8765", true},
		{"localhost:8765", true},
		{"localhost", true},
		{"[::1]:8765", true},
		{"127.0.0.2:8765", true},

		{"code.elffuss.com", false},
		{"evil.example:8765", false},
		{"0.0.0.0:8765", false},
		{"192.168.1.10:8765", false},
		{"", false},
	}
	for _, c := range cases {
		if got := hostIsLoopback(c.host); got != c.want {
			t.Errorf("hostIsLoopback(%q) = %v, want %v", c.host, got, c.want)
		}
	}
}
