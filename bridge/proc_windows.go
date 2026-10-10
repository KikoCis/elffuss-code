//go:build windows

package main

import (
	"os"
	"os/exec"
	"strconv"
	"time"
)

// Señales con las que se cierra el bridge (Ctrl+C en su ventana).
var shutdownSignals = []os.Signal{os.Interrupt}

// taskkill /F no espera a nadie: no hace falta margen.
const killGrace = 0 * time.Second

func prepareTree(c *exec.Cmd) {}

// forceKill: en Windows killTree ya es a la fuerza.
func forceKill(c *exec.Cmd) { killTree(c) }

// killTree para el árbol entero: taskkill /T sigue a los hijos del cmd.exe que
// arranca el bridge (/F: sin esperar a que acepten). Si taskkill falla, al menos
// el cmd.exe.
func killTree(c *exec.Cmd) {
	if c.Process == nil {
		return
	}
	if err := exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(c.Process.Pid)).Run(); err != nil {
		_ = c.Process.Kill()
	}
}
