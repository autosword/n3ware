package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
	}

	project := os.Getenv("GOOGLE_CLOUD_PROJECT")
	if project == "" {
		log.Fatal("GOOGLE_CLOUD_PROJECT env var required")
	}

	bucket := os.Getenv("GCS_BUCKET")
	if bucket == "" {
		bucket = "n3ware-sites"
	}

	ctx := context.Background()

	gcs, err := NewGCSClient(ctx, bucket)
	if err != nil {
		log.Fatalf("GCS init: %v", err)
	}

	fs, err := NewFirestoreClient(ctx, project)
	if err != nil {
		log.Fatalf("Firestore init: %v", err)
	}

	cache := NewLRUCache(100, 10) // 10s TTL — content changes on save

	assembler := &Assembler{
		gcs:    gcs,
		fs:     fs,
		cache:  cache,
		bucket: bucket,
	}

	domain := &DomainResolver{fs: fs}

	mux := http.NewServeMux()

	// Health check
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"status":"ok"}`)
	})

	// Cache purge — POST /purge/{siteId} invalidates all pages for a site
	mux.HandleFunc("/purge/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		siteId := strings.TrimPrefix(r.URL.Path, "/purge/")
		if siteId == "" {
			http.Error(w, "missing site id", http.StatusBadRequest)
			return
		}
		cache.InvalidatePrefix(siteId)
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"purged":true,"siteId":"%s"}`, siteId)
	})

	// Site assembly — accepts either:
	//   /sites/{siteId}[/path]          direct siteId
	//   everything else → domain lookup
	mux.HandleFunc("/sites/", func(w http.ResponseWriter, r *http.Request) {
		parts := strings.SplitN(strings.TrimPrefix(r.URL.Path, "/sites/"), "/", 2)
		siteId := parts[0]
		pagePath := "/"
		if len(parts) == 2 && parts[1] != "" {
			pagePath = "/" + parts[1]
		}
		assembler.ServeRequest(w, r, siteId, pagePath)
	})

	// Domain-based routing (Cloud Run receives host header)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		// Strip port if present
		if idx := strings.LastIndex(host, ":"); idx != -1 {
			host = host[:idx]
		}

		siteId, err := domain.Resolve(r.Context(), host)
		if err != nil || siteId == "" {
			http.Error(w, "site not found", http.StatusNotFound)
			return
		}
		assembler.ServeRequest(w, r, siteId, r.URL.Path)
	})

	log.Printf("n3ware assembler listening on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal(err)
	}
}
