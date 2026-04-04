package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"
)

// SiteManifest mirrors the site.json stored in GCS.
type SiteManifest struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	OwnerId string `json:"ownerId"`
	Theme   struct {
		PrimaryColor string `json:"primaryColor"`
		FontFamily   string `json:"fontFamily"`
	} `json:"theme"`
	Pages []struct {
		Slug  string `json:"slug"`
		Title string `json:"title"`
		Path  string `json:"path"`
	} `json:"pages"`
	HeadScripts []string `json:"headScripts"`
	BodyScripts []string `json:"bodyScripts"`
	UpdatedAt   string   `json:"updatedAt"`
}

// Assembler assembles full HTML pages from GCS components.
type Assembler struct {
	gcs    *GCSClient
	fs     *FirestoreClient
	cache  *LRUCache
	bucket string
}

const cacheControl = "public, s-maxage=300, stale-while-revalidate=60"

// ServeRequest assembles and serves the page for the given siteId + path.
func (a *Assembler) ServeRequest(w http.ResponseWriter, r *http.Request, siteId, pagePath string) {
	if siteId == "" {
		http.Error(w, "site not found", http.StatusNotFound)
		return
	}

	cacheKey := siteId + "::" + pagePath
	if cached, ok := a.cache.Get(cacheKey); ok {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", cacheControl)
		w.Header().Set("X-Cache", "HIT")
		w.Header().Set("X-Site-Id", siteId)
		fmt.Fprint(w, cached)
		return
	}

	html, err := a.assemble(r, siteId, pagePath)
	if err != nil {
		log.Printf("[assembler] error for site=%s path=%s: %v", siteId, pagePath, err)
		http.Error(w, "assembly error", http.StatusInternalServerError)
		return
	}

	a.cache.Set(cacheKey, html)

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", cacheControl)
	w.Header().Set("X-Cache", "MISS")
	w.Header().Set("X-Site-Id", siteId)
	fmt.Fprint(w, html)
}

func (a *Assembler) assemble(r *http.Request, siteId, pagePath string) (string, error) {
	ctx := r.Context()

	// 1. Read site manifest
	manifestBytes, err := a.gcs.ReadFile(ctx, siteId+"/site.json")
	if err != nil {
		return "", fmt.Errorf("read manifest: %w", err)
	}
	var manifest SiteManifest
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		return "", fmt.Errorf("parse manifest: %w", err)
	}

	// 2. Find page slug matching path
	slug := resolveSlug(manifest, pagePath)
	if slug == "" {
		return notFoundPage(manifest.Name), nil
	}

	// 3. Read components (concurrently would be ideal; sequential for simplicity)
	header, _ := a.gcs.ReadFile(ctx, siteId+"/header.html")
	nav, _    := a.gcs.ReadFile(ctx, siteId+"/nav.html")
	footer, _ := a.gcs.ReadFile(ctx, siteId+"/footer.html")

	pageBody, err := a.gcs.ReadFile(ctx, siteId+"/pages/"+slug+".html")
	if err != nil {
		return notFoundPage(manifest.Name), nil
	}

	// 4. Find page title
	pageTitle := manifest.Name
	for _, p := range manifest.Pages {
		if p.Slug == slug {
			if p.Title != "" {
				pageTitle = p.Title + " — " + manifest.Name
			}
			break
		}
	}

	// 5. Build head scripts block
	var headScripts strings.Builder
	headScripts.WriteString(`<script src="https://cdn.tailwindcss.com"></script>` + "\n")
	if manifest.Theme.PrimaryColor != "" || manifest.Theme.FontFamily != "" {
		headScripts.WriteString("<script>\n  tailwind.config = {\n    theme: { extend: {\n")
		if manifest.Theme.PrimaryColor != "" {
			headScripts.WriteString(fmt.Sprintf("      colors: { primary: '%s' },\n", manifest.Theme.PrimaryColor))
		}
		if manifest.Theme.FontFamily != "" {
			headScripts.WriteString(fmt.Sprintf("      fontFamily: { sans: ['%s', 'sans-serif'] },\n", manifest.Theme.FontFamily))
		}
		headScripts.WriteString("    }}\n  }\n</script>\n")
	}
	for _, s := range manifest.HeadScripts {
		headScripts.WriteString(s + "\n")
	}

	// 6. Build body scripts block
	var bodyScripts strings.Builder
	for _, s := range manifest.BodyScripts {
		bodyScripts.WriteString(s + "\n")
	}

	// 7. Assemble full document
	now := time.Now().UTC().Format(time.RFC3339)
	_ = now

	html := fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>%s</title>
%s</head>
<body>
%s
%s
<main>
%s
</main>
%s
%s</body>
</html>`,
		escapeHTML(pageTitle),
		headScripts.String(),
		string(header),
		string(nav),
		string(pageBody),
		string(footer),
		bodyScripts.String(),
	)

	return html, nil
}

func resolveSlug(manifest SiteManifest, path string) string {
	// Normalize path
	p := strings.TrimRight(path, "/")
	if p == "" {
		p = "/"
	}

	for _, page := range manifest.Pages {
		pagePath := strings.TrimRight(page.Path, "/")
		if pagePath == "" {
			pagePath = "/"
		}
		if pagePath == p {
			return page.Slug
		}
	}

	// Fallback: try matching slug directly from path segment
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) > 0 && parts[0] != "" {
		slug := parts[0]
		for _, page := range manifest.Pages {
			if page.Slug == slug {
				return slug
			}
		}
	}

	// Final fallback: return "index" if path is root
	if p == "/" {
		return "index"
	}
	return ""
}

func escapeHTML(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, `"`, "&quot;")
	return s
}

func notFoundPage(siteName string) string {
	return fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Page Not Found — %s</title>
<script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-900 text-slate-100 flex items-center justify-center min-h-screen">
<div class="text-center">
  <div class="text-blue-400 text-7xl font-black mb-2">404</div>
  <h1 class="text-2xl font-bold mb-2">Page Not Found</h1>
  <p class="text-slate-400 mb-6">This page doesn't exist on %s.</p>
  <a href="/" class="text-blue-400 hover:underline">← Back to home</a>
</div>
</body>
</html>`, escapeHTML(siteName), escapeHTML(siteName))
}
