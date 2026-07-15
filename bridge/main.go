// Elffuss Bridge — puente local para que Elffuss Code (el navegador) pueda
// ejecutar comandos REALES en tu máquina (node, npm, python…), sin salir de
// tu ordenador. Escucha SOLO en 127.0.0.1 y exige:
//   1) Origin permitido (elffuss-code.utopiaia.com o localhost de desarrollo)
//   2) un TOKEN de un solo arranque, que se imprime aquí y se pega en la web
// Sin ambas cosas, ninguna página puede conectarse ni ejecutar nada.
package main

import (
	"crypto/rand"
	"encoding/hex"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
)

const version = "1.0.0"

var allowedOrigins = map[string]bool{
	"https://elffuss-code.utopiaia.com": true,
	"http://localhost:8799":             true,
	"http://127.0.0.1:8799":             true,
}

func genToken() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		// fallback muy improbable; nunca dejar el bridge sin token
		return "fallback-token-regenera-el-bridge"
	}
	return hex.EncodeToString(b)
}

// ---- mensajes del protocolo (JSON por el WebSocket) ----
type inMsg struct {
	Type  string `json:"type"`            // auth | exec | stop
	Token string `json:"token,omitempty"` // auth
	ID    string `json:"id,omitempty"`    // exec | stop
	Cmd   string `json:"cmd,omitempty"`   // exec
	Cwd   string `json:"cwd,omitempty"`   // exec (vacío → carpeta temporal)
}
type outMsg struct {
	Type string `json:"type"` // auth-ok | auth-fail | stdout | stderr | exit | error
	ID   string `json:"id,omitempty"`
	Data string `json:"data,omitempty"`
	Code int    `json:"code,omitempty"`
}

type session struct {
	conn    *websocket.Conn
	writeMu sync.Mutex
	authed  bool
	procsMu sync.Mutex
	procs   map[string]*exec.Cmd
}

func (s *session) send(m outMsg) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	_ = s.conn.WriteJSON(m)
}

func shellFor(cmdline string) *exec.Cmd {
	if runtime.GOOS == "windows" {
		return exec.Command("cmd", "/C", cmdline)
	}
	return exec.Command("sh", "-c", cmdline)
}

func (s *session) runExec(m inMsg) {
	cwd := strings.TrimSpace(m.Cwd)
	if cwd == "" {
		cwd = os.TempDir()
	}
	c := shellFor(m.Cmd)
	c.Dir = cwd
	stdout, err1 := c.StdoutPipe()
	stderr, err2 := c.StderrPipe()
	if err1 != nil || err2 != nil {
		s.send(outMsg{Type: "error", ID: m.ID, Data: "no pude preparar el proceso"})
		return
	}
	if err := c.Start(); err != nil {
		s.send(outMsg{Type: "error", ID: m.ID, Data: "no pude arrancar: " + err.Error()})
		return
	}
	s.procsMu.Lock()
	s.procs[m.ID] = c
	s.procsMu.Unlock()

	var wg sync.WaitGroup
	wg.Add(2)
	pump := func(r io.Reader, kind string) {
		defer wg.Done()
		buf := make([]byte, 4096)
		for {
			n, err := r.Read(buf)
			if n > 0 {
				s.send(outMsg{Type: kind, ID: m.ID, Data: string(buf[:n])})
			}
			if err != nil {
				return
			}
		}
	}
	go pump(stdout, "stdout")
	go pump(stderr, "stderr")
	wg.Wait()

	code := 0
	if err := c.Wait(); err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			code = ee.ExitCode()
		} else {
			code = -1
		}
	}
	s.procsMu.Lock()
	delete(s.procs, m.ID)
	s.procsMu.Unlock()
	s.send(outMsg{Type: "exit", ID: m.ID, Code: code})
}

func (s *session) stop(id string) {
	s.procsMu.Lock()
	c := s.procs[id]
	s.procsMu.Unlock()
	if c != nil && c.Process != nil {
		_ = c.Process.Kill()
	}
}

func serveWS(token string) http.HandlerFunc {
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return allowedOrigins[r.Header.Get("Origin")]
		},
	}
	return func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Println("conexión rechazada (origen no permitido u otro error):", err)
			return
		}
		defer conn.Close()
		s := &session{conn: conn, procs: map[string]*exec.Cmd{}}
		log.Println("nueva conexión desde", r.RemoteAddr, "origin:", r.Header.Get("Origin"))
		for {
			var m inMsg
			if err := conn.ReadJSON(&m); err != nil {
				break
			}
			switch m.Type {
			case "auth":
				if m.Token == token {
					s.authed = true
					s.send(outMsg{Type: "auth-ok"})
					log.Println("✔ autenticado")
				} else {
					s.send(outMsg{Type: "auth-fail"})
					log.Println("✕ token incorrecto — conexión rechazada")
					conn.Close()
					return
				}
			case "exec":
				if !s.authed {
					s.send(outMsg{Type: "error", ID: m.ID, Data: "no autenticado"})
					continue
				}
				go s.runExec(m)
			case "stop":
				if s.authed {
					s.stop(m.ID)
				}
			}
		}
		log.Println("conexión cerrada")
	}
}

func main() {
	port := flag.Int("port", 8765, "puerto local (solo 127.0.0.1)")
	tokenFlag := flag.String("token", "", "token fijo (por defecto se genera uno nuevo)")
	flag.Parse()

	token := *tokenFlag
	if token == "" {
		token = genToken()
	}

	fmt.Println("🧝 Elffuss Bridge", version, "—", runtime.GOOS+"/"+runtime.GOARCH)
	fmt.Println("   Escuchando SOLO en 127.0.0.1:" + fmt.Sprint(*port) + " (nada sale de tu máquina)")
	fmt.Println()
	fmt.Println("   TOKEN (pégalo en Elffuss Code → 🔌 Bridge local):")
	fmt.Println("   " + token)
	fmt.Println()
	fmt.Println("   Ctrl+C para parar. Deja esta ventana abierta mientras lo uses.")

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", serveWS(token))
	mux.HandleFunc("/ping", func(w http.ResponseWriter, r *http.Request) {
		// sondeo ligero SIN exigir el token, solo para que la web sepa "hay
		// un bridge escuchando aquí" antes de pedir el token al usuario.
		// También respeta el Origin permitido.
		if !allowedOrigins[r.Header.Get("Origin")] {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		w.Header().Set("Access-Control-Allow-Origin", r.Header.Get("Origin"))
		_, _ = w.Write([]byte(`{"ok":true,"version":"` + version + `"}`))
	})

	addr := "127.0.0.1:" + fmt.Sprint(*port)
	log.Fatal(http.ListenAndServe(addr, mux))
}
