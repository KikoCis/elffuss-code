//go:build !windows

package main

import (
	"bufio"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// vivo: ¿existe todavía el proceso? (un zombi cuenta hasta que lo recogen)
func vivo(pid int) bool { return syscall.Kill(pid, 0) == nil }

func esperaMuerto(t *testing.T, pid int) bool {
	t.Helper()
	for i := 0; i < 100; i++ {
		if !vivo(pid) {
			return true
		}
		time.Sleep(50 * time.Millisecond)
	}
	return false
}

// Parar un comando mata también lo que el sh lanzó, no solo el sh.
func TestKillTreeKillsWhatTheShellStarted(t *testing.T) {
	c := shellFor("sleep 30 & echo $!; wait")
	out, err := c.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := c.Start(); err != nil {
		t.Fatal(err)
	}
	line, err := bufio.NewReader(out).ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	hijo, err := strconv.Atoi(strings.TrimSpace(line))
	if err != nil || !vivo(hijo) {
		t.Fatalf("no hay hijo vivo que parar: %q", line)
	}
	killTree(c)
	_ = c.Wait()
	if !esperaMuerto(t, hijo) {
		_ = syscall.Kill(hijo, syscall.SIGKILL)
		t.Fatalf("el hijo del sh (%d) sigue vivo tras parar", hijo)
	}
}

const tokenPrueba = "token-de-prueba-del-bridge-0123456789"

type cliente struct {
	t    *testing.T
	conn *websocket.Conn
}

func conecta(t *testing.T, root string) (*cliente, func()) {
	t.Helper()
	srv := httptest.NewServer(serveWS(tokenPrueba, root))
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	conn, _, err := websocket.DefaultDialer.Dial(url, http.Header{"Origin": {"http://localhost:8799"}})
	if err != nil {
		srv.Close()
		t.Fatal(err)
	}
	cl := &cliente{t: t, conn: conn}
	cl.manda(inMsg{Type: "auth", Token: tokenPrueba})
	if m := cl.lee(); m.Type != "auth-ok" {
		t.Fatalf("sin auth-ok: %+v", m)
	}
	return cl, func() { conn.Close(); srv.Close() }
}

func (c *cliente) manda(m inMsg) {
	if err := c.conn.WriteJSON(m); err != nil {
		c.t.Fatal(err)
	}
}

func (c *cliente) lee() outMsg {
	c.t.Helper()
	var m outMsg
	_ = c.conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	if err := c.conn.ReadJSON(&m); err != nil {
		c.t.Fatal(err)
	}
	return m
}

// lee hasta el «exit» de ese id
func (c *cliente) salida(id string) outMsg {
	c.t.Helper()
	for {
		m := c.lee()
		if m.ID == id && (m.Type == "exit" || m.Type == "error") {
			return m
		}
	}
}

// Un «stop» que llega antes de que el proceso haya arrancado no se pierde: antes
// el bridge no encontraba el id y el comando corría hasta el final.
func TestStopRightAfterExecIsNotLost(t *testing.T) {
	root := t.TempDir()
	cl, cerrar := conecta(t, root)
	defer cerrar()
	for i := 0; i < 10; i++ {
		id := "pronto-" + strconv.Itoa(i)
		marca := filepath.Join(root, id)
		cl.manda(inMsg{Type: "exec", ID: id, Cmd: "sleep 1; touch '" + marca + "'"})
		cl.manda(inMsg{Type: "stop", ID: id})
		cl.salida(id)
	}
	time.Sleep(1500 * time.Millisecond)
	for i := 0; i < 10; i++ {
		if _, err := os.Stat(filepath.Join(root, "pronto-"+strconv.Itoa(i))); err == nil {
			t.Errorf("el comando %d se paró nada más mandarlo y aun así terminó", i)
		}
	}
}

// Y un «stop» de un id que todavía no ha llegado se recuerda para cuando llegue.
func TestStopBeforeExecIsRemembered(t *testing.T) {
	root := t.TempDir()
	cl, cerrar := conecta(t, root)
	defer cerrar()
	marca := filepath.Join(root, "antes")
	cl.manda(inMsg{Type: "stop", ID: "x"})
	cl.manda(inMsg{Type: "exec", ID: "x", Cmd: "touch '" + marca + "'"})
	if m := cl.salida("x"); m.Type != "exit" || m.Code != exitStopped {
		t.Errorf("esperaba exit %d sin arrancar, llegó %+v", exitStopped, m)
	}
	time.Sleep(300 * time.Millisecond)
	if _, err := os.Stat(marca); err == nil {
		t.Error("el comando corrió aunque su «stop» llegó antes")
	}
}

// Cerrar el socket con un comando en marcha mata el comando y lo que lanzó.
func TestSocketCloseKillsTheTree(t *testing.T) {
	root := t.TempDir()
	cl, cerrar := conecta(t, root)
	defer cerrar()
	cl.manda(inMsg{Type: "exec", ID: "largo", Cmd: "sleep 30 & echo $!; wait"})
	var hijo int
	for hijo == 0 {
		m := cl.lee()
		if m.ID == "largo" && m.Type == "stdout" {
			hijo, _ = strconv.Atoi(strings.TrimSpace(m.Data))
		}
	}
	if !vivo(hijo) {
		t.Fatalf("el hijo %d no llegó a estar vivo", hijo)
	}
	cl.conn.Close()
	if !esperaMuerto(t, hijo) {
		_ = syscall.Kill(hijo, syscall.SIGKILL)
		t.Fatalf("cerrar el socket dejó vivo el hijo %d", hijo)
	}
}
