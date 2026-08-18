// Elffuss Bridge — puente local para que Elffuss Code (el navegador) pueda
// ejecutar comandos REALES en tu máquina (node, npm, python…), sin salir de
// tu ordenador. Escucha SOLO en 127.0.0.1 y exige:
//   1) Origin permitido (elffuss-code.utopiaia.com o localhost de desarrollo)
//   2) cabecera Host de loopback (defensa extra contra DNS-rebinding)
//   3) un TOKEN de un solo arranque, que se imprime aquí y se pega en la web
// Sin las tres cosas, ninguna página puede conectarse ni ejecutar nada.
//
// Además, la ejecución está ACOTADA a una carpeta raíz (--root, por defecto el
// directorio desde el que arrancas el bridge): un comando no puede usar como
// cwd nada fuera de esa raíz. Esto NO es un sandbox — «sh -c» puede leer con
// ruta absoluta fuera de la raíz (p.ej. ~/.ssh) —, pero reduce el radio si el
// token se filtra, y evita el viejo comportamiento de correr en el temp global.
// Para aislamiento real, arranca el propio bridge en un contenedor o usuario
// restringido. --allow-any desactiva la restricción de raíz (no recomendado).
package main

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
)

const version = "1.1.0"

// Tope de salida por comando: evita que un proceso que escupe sin fin inunde el
// WebSocket (DoS de memoria). Al superarlo se corta y se avisa.
const maxOutputBytes = 8 << 20 // 8 MiB

var allowedOrigins = map[string]bool{
	"https://elffuss-code.utopiaia.com": true,
	"http://localhost:8799":             true,
	"http://127.0.0.1:8799":             true,
}

func genToken() string {
	b := make([]byte, 32) // 256 bits
	if _, err := rand.Read(b); err != nil {
		// Sin aleatoriedad segura NO se arranca: un token predecible es un
		// agujero peor que no tener bridge. Antes esto devolvía un token fijo.
		log.Fatal("no hay fuente de aleatoriedad segura; abortando para no exponer un token débil")
	}
	return hex.EncodeToString(b)
}

// tokenEqual compara en tiempo constante: evita distinguir el token por el
// tiempo de respuesta (timing attack). Con «==» el corto-circuito filtra cuántos
// bytes iniciales aciertas.
func tokenEqual(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// hostIsLoopback: la cabecera Host debe ser 127.0.0.1/localhost. Un ataque de
// DNS-rebinding llega con Host = dominio del atacante aunque resuelva a 127.0.0.1;
// esto lo rechaza además del Origin.
func hostIsLoopback(host string) bool {
	h := host
	if i := strings.LastIndex(h, ":"); i != -1 && !strings.Contains(h[i:], "]") {
		h = h[:i]
	}
	h = strings.Trim(h, "[]")
	if h == "localhost" {
		return true
	}
	ip := net.ParseIP(h)
	return ip != nil && ip.IsLoopback()
}

// ---- mensajes del protocolo (JSON por el WebSocket) ----
type inMsg struct {
	Type  string `json:"type"`            // auth | exec | stop
	Token string `json:"token,omitempty"` // auth
	ID    string `json:"id,omitempty"`    // exec | stop
	Cmd   string `json:"cmd,omitempty"`   // exec
	Cwd   string `json:"cwd,omitempty"`   // exec (vacío → raíz)
}
type outMsg struct {
	Type string `json:"type"` // auth-ok | auth-fail | stdout | stderr | exit | error
	ID   string `json:"id,omitempty"`
	Data string `json:"data,omitempty"`
	Code int    `json:"code,omitempty"`
}

type session struct {
	conn     *websocket.Conn
	writeMu  sync.Mutex
	authed   bool
	root     string // carpeta raíz permitida (absoluta), "" = sin restricción
	procsMu  sync.Mutex
	procs    map[string]*exec.Cmd
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

// resolveCwd valida el directorio de trabajo pedido contra la raíz permitida.
// Devuelve (dir, ""), o ("", motivo) si escapa de la raíz.
func (s *session) resolveCwd(reqCwd string) (string, string) {
	if s.root == "" {
		if reqCwd == "" {
			return os.TempDir(), ""
		}
		return reqCwd, ""
	}
	dir := reqCwd
	if dir == "" {
		return s.root, ""
	}
	if !filepath.IsAbs(dir) {
		dir = filepath.Join(s.root, dir)
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return "", "cwd inválido"
	}
	rel, err := filepath.Rel(s.root, abs)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return "", "cwd fuera de la carpeta permitida (" + s.root + ")"
	}
	return abs, ""
}

func (s *session) runExec(m inMsg) {
	if strings.TrimSpace(m.Cmd) == "" {
		s.send(outMsg{Type: "error", ID: m.ID, Data: "comando vacío"})
		s.send(outMsg{Type: "exit", ID: m.ID, Code: -1})
		return
	}
	cwd, why := s.resolveCwd(strings.TrimSpace(m.Cwd))
	if why != "" {
		s.send(outMsg{Type: "error", ID: m.ID, Data: why})
		s.send(outMsg{Type: "exit", ID: m.ID, Code: -1})
		return
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

	var sent int64
	var sentMu sync.Mutex
	capped := false
	var wg sync.WaitGroup
	wg.Add(2)
	pump := func(r io.Reader, kind string) {
		defer wg.Done()
		buf := make([]byte, 4096)
		for {
			n, err := r.Read(buf)
			if n > 0 {
				sentMu.Lock()
				if sent < maxOutputBytes {
					s.send(outMsg{Type: kind, ID: m.ID, Data: string(buf[:n])})
					sent += int64(n)
					if sent >= maxOutputBytes && !capped {
						capped = true
						s.send(outMsg{Type: "stderr", ID: m.ID, Data: "\n[bridge: salida cortada a 8 MiB — mata el proceso o filtra la salida]\n"})
						// matar el proceso para no seguir consumiendo la máquina
						s.stop(m.ID)
					}
				}
				sentMu.Unlock()
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

func serveWS(token, root string) http.HandlerFunc {
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			// Origin permitido Y Host de loopback: dos gates independientes.
			return allowedOrigins[r.Header.Get("Origin")] && hostIsLoopback(r.Host)
		},
	}
	return func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Println("conexión rechazada (origen/host no permitido u otro error):", err)
			return
		}
		defer conn.Close()
		s := &session{conn: conn, procs: map[string]*exec.Cmd{}, root: root}
		log.Println("nueva conexión desde", r.RemoteAddr, "origin:", r.Header.Get("Origin"))
		attempts := 0
		for {
			var m inMsg
			if err := conn.ReadJSON(&m); err != nil {
				break
			}
			switch m.Type {
			case "auth":
				if tokenEqual(m.Token, token) {
					s.authed = true
					s.send(outMsg{Type: "auth-ok"})
					log.Println("✔ autenticado")
				} else {
					attempts++
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
			_ = attempts
		}
		log.Println("conexión cerrada")
	}
}

func main() {
	port := flag.Int("port", 8765, "puerto local (solo 127.0.0.1)")
	tokenFlag := flag.String("token", "", "token fijo (por defecto se genera uno de 256 bits)")
	rootFlag := flag.String("root", "", "carpeta raíz a la que se acota la ejecución (por defecto: el directorio actual)")
	allowAny := flag.Bool("allow-any", false, "PELIGRO: permite ejecutar en cualquier carpeta (desactiva la restricción de raíz)")
	flag.Parse()

	token := *tokenFlag
	if token == "" {
		token = genToken()
	} else if len(token) < 24 {
		log.Fatal("el --token fijo es demasiado corto; usa al menos 24 caracteres o deja que se genere uno")
	}

	root := ""
	if !*allowAny {
		root = *rootFlag
		if root == "" {
			wd, err := os.Getwd()
			if err != nil {
				log.Fatal("no pude determinar el directorio actual para --root; pásalo explícitamente")
			}
			root = wd
		}
		if abs, err := filepath.Abs(root); err == nil {
			root = abs
		}
	}

	fmt.Println("🧝 Elffuss Bridge", version, "—", runtime.GOOS+"/"+runtime.GOARCH)
	fmt.Println("   Escuchando SOLO en 127.0.0.1:" + fmt.Sprint(*port) + " (nada sale de tu máquina)")
	if root != "" {
		fmt.Println("   Ejecución acotada a:", root)
	} else {
		fmt.Println("   ⚠ --allow-any: la ejecución NO está acotada a ninguna carpeta")
	}
	fmt.Println()
	fmt.Println("   TOKEN (pégalo en Elffuss Code → 🔌 Bridge local):")
	fmt.Println("   " + token)
	fmt.Println()
	fmt.Println("   Ctrl+C para parar. Deja esta ventana abierta mientras lo uses.")

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", serveWS(token, root))
	mux.HandleFunc("/ping", func(w http.ResponseWriter, r *http.Request) {
		// sondeo ligero SIN token, solo para que la web sepa «hay un bridge aquí».
		// Respeta Origin permitido Y Host de loopback, igual que /ws.
		if !allowedOrigins[r.Header.Get("Origin")] || !hostIsLoopback(r.Host) {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		w.Header().Set("Access-Control-Allow-Origin", r.Header.Get("Origin"))
		w.Header().Set("Vary", "Origin")
		_, _ = w.Write([]byte(`{"ok":true,"version":"` + version + `"}`))
	})

	addr := "127.0.0.1:" + fmt.Sprint(*port)
	log.Fatal(http.ListenAndServe(addr, mux))
}
