package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"relaycore/internal/common"
	"relaycore/internal/panel"
)

func main() {
	addr := flag.String("addr", env("RELAYCORE_ADDR", "127.0.0.1:10028"), "panel listen address")
	dataDir := flag.String("data", env("RELAYCORE_DATA", "./data"), "data directory")
	webDir := flag.String("web", env("RELAYCORE_WEB", "./web"), "web asset directory")
	adminUser := flag.String("admin-user", env("ADMIN_USER", "admin"), "initial admin username")
	adminPassword := flag.String("admin-password", env("ADMIN_PASSWORD", ""), "initial admin password")
	version := flag.Bool("version", false, "print version")
	flag.Parse()

	if *version {
		fmt.Println(common.ProjectName, common.Version)
		return
	}

	storePath := filepath.Join(*dataDir, "relaycore.db")
	st, initialPassword, err := panel.OpenStore(storePath, *adminUser, *adminPassword)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	if initialPassword != "" {
		log.Printf("============================================================")
		log.Printf("%s initial admin username: %s", common.ProjectName, *adminUser)
		log.Printf("%s initial admin password: %s", common.ProjectName, initialPassword)
		log.Printf("Change this password after first login.")
		log.Printf("============================================================")
	}

	srv := panel.NewServer(st, *addr, *webDir)
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		srv.Stop()
	}()
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("panel stopped with error: %v", err)
	}
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
