//go:build !windows

package main

import (
	"os"
	"os/exec"
	"syscall"
	"time"
)

// Señales con las que se cierra el bridge (Ctrl+C, kill, cerrar la ventana).
var shutdownSignals = []os.Signal{os.Interrupt, syscall.SIGTERM, syscall.SIGHUP}

// Margen entre SIGTERM y SIGKILL: lo justo para que npm o un servidor de
// desarrollo terminen por las buenas.
const killGrace = 2 * time.Second

// prepareTree arranca el comando en su propio grupo de procesos: todo lo que
// lance (el node de un `npm run dev`, cada parte de `a; b`) queda en ese grupo.
func prepareTree(c *exec.Cmd) {
	c.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

// killTree para el grupo entero: SIGTERM y, si alguno sigue vivo pasado el
// margen, SIGKILL.
func killTree(c *exec.Cmd) {
	if c.Process == nil {
		return
	}
	pgid := c.Process.Pid // con Setpgid el grupo lleva el pid del sh
	if err := syscall.Kill(-pgid, syscall.SIGTERM); err != nil {
		_ = c.Process.Kill()
		return
	}
	go func() {
		time.Sleep(killGrace)
		if syscall.Kill(-pgid, 0) == nil {
			_ = syscall.Kill(-pgid, syscall.SIGKILL)
		}
	}()
}

// forceKill remata el grupo sin margen (al cerrar el bridge).
func forceKill(c *exec.Cmd) {
	if c.Process != nil {
		_ = syscall.Kill(-c.Process.Pid, syscall.SIGKILL)
	}
}
