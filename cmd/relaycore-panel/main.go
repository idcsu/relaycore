package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
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
	resetAdminPassword := flag.Bool("reset-admin-password", false, "reset the admin password and exit")
	version := flag.Bool("version", false, "print version")
	flag.Parse()

	if *version {
		fmt.Println(common.ProjectName, common.Version)
		return
	}

	storePath := filepath.Join(*dataDir, "relaycore.db")

	if *resetAdminPassword {
		resetPassword(storePath, *adminUser, *adminPassword)
		return
	}

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

func resetPassword(storePath, adminUser, adminPassword string) {
	st, _, err := panel.OpenStore(storePath, adminUser, "")
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	users := st.ListUsers()
	var targetID string
	for _, u := range users {
		if u.Role == common.RoleSuperAdmin && strings.EqualFold(u.Username, strings.TrimSpace(adminUser)) {
			targetID = u.ID
			break
		}
	}
	if targetID == "" {
		for _, u := range users {
			if u.Role == common.RoleSuperAdmin {
				targetID = u.ID
				adminUser = u.Username
				break
			}
		}
	}
	if targetID == "" {
		log.Fatalf("no super_admin user found")
	}
	actor := common.User{ID: targetID, Role: common.RoleSuperAdmin, Username: adminUser}
	_, generated, err := st.ResetUserPassword(targetID, adminPassword, actor, "127.0.0.1")
	if err != nil {
		log.Fatalf("reset password: %v", err)
	}
	if generated != "" {
		fmt.Printf("============================================================\n")
		fmt.Printf("Admin password reset for user: %s\n", adminUser)
		fmt.Printf("New password: %s\n", generated)
		fmt.Printf("Change this password after login.\n")
		fmt.Printf("============================================================\n")
	} else {
		fmt.Printf("Admin password reset for user: %s\n", adminUser)
	}
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
