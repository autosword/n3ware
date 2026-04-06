package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// SiteManifest mirrors the site.json stored in GCS.
type SiteManifest struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	OwnerId string `json:"ownerId"`
	APIKey  string `json:"apiKey"`
	Theme struct {
		Colors struct {
			Primary   string `json:"primary"`
			Secondary string `json:"secondary"`
			Accent    string `json:"accent"`
		} `json:"colors"`
		LogoUrl    string `json:"logoUrl"`
		FaviconUrl string `json:"faviconUrl"`
		Fonts struct {
			Heading string `json:"heading"`
			Body    string `json:"body"`
		} `json:"fonts"`
		Sizes struct {
			H1   int `json:"h1"`
			H2   int `json:"h2"`
			H3   int `json:"h3"`
			H4   int `json:"h4"`
			H5   int `json:"h5"`
			H6   int `json:"h6"`
			Body int `json:"body"`
		} `json:"sizes"`
	} `json:"theme"`
	Pages []struct {
		Slug  string `json:"slug"`
		Title string `json:"title"`
		Path  string `json:"path"`
	} `json:"pages"`
	Collections []CollectionMeta `json:"collections"`
	HeadScripts []string         `json:"headScripts"`
	BodyScripts []string         `json:"bodyScripts"`
	UpdatedAt   string           `json:"updatedAt"`
}

// CollectionMeta is a lightweight summary of a collection stored in site.json.
type CollectionMeta struct {
	Slug       string `json:"slug"`
	Name       string `json:"name"`
	EntryCount int    `json:"entryCount"`
}

// Assembler assembles full HTML pages from GCS components.
type Assembler struct {
	gcs    *GCSClient
	fs     *FirestoreClient
	cache  *LRUCache
	bucket string
}

const cacheControl = "public, max-age=10, s-maxage=30, stale-while-revalidate=5"

var eachPattern = regexp.MustCompile(`\{\{#each\s+(\w+)`)

// findReferencedCollections scans HTML for {{#each slug}} directives and returns unique slugs.
func findReferencedCollections(html string) []string {
	matches := eachPattern.FindAllStringSubmatch(html, -1)
	seen := map[string]bool{}
	var slugs []string
	for _, m := range matches {
		if !seen[m[1]] {
			seen[m[1]] = true
			slugs = append(slugs, m[1])
		}
	}
	return slugs
}

// loadCollectionEntries reads all entry JSON files for a collection from GCS.
// Returns entries sorted by data.order asc, then createdAt asc.
func (a *Assembler) loadCollectionEntries(ctx context.Context, siteId, slug string) ([]Entry, error) {
	cacheKey := "collections/" + siteId + "/" + slug
	if cached, ok := a.cache.Get(cacheKey); ok {
		var entries []Entry
		if err := json.Unmarshal([]byte(cached), &entries); err == nil {
			return entries, nil
		}
	}

	prefix := siteId + "/collections/" + slug + "/"
	objs, err := a.gcs.ListFiles(ctx, prefix)
	if err != nil {
		return nil, err
	}

	var entries []Entry
	for _, objPath := range objs {
		data, err := a.gcs.ReadFile(ctx, objPath)
		if err != nil {
			continue
		}
		var e Entry
		if err := json.Unmarshal(data, &e); err != nil {
			continue
		}
		entries = append(entries, e)
	}

	if b, err := json.Marshal(entries); err == nil {
		a.cache.Set(cacheKey, string(b))
	}
	return entries, nil
}

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

	// Resolve theme values
	th := manifest.Theme
	primary := th.Colors.Primary
	if primary == "" { primary = "#3B82F6" }
	secondary := th.Colors.Secondary
	if secondary == "" { secondary = "#8B5CF6" }
	accent := th.Colors.Accent
	if accent == "" { accent = "#F59E0B" }

	bodyFontCss := "system-ui,-apple-system,sans-serif"
	if th.Fonts.Body != "" && th.Fonts.Body != "system" {
		bodyFontCss = "'" + th.Fonts.Body + "',sans-serif"
	}
	headingFontCss := "system-ui,-apple-system,sans-serif"
	if th.Fonts.Heading != "" && th.Fonts.Heading != "system" {
		headingFontCss = "'" + th.Fonts.Heading + "',sans-serif"
	}

	headScripts.WriteString("<style id=\"n3-theme-vars\">\n:root{\n")
	headScripts.WriteString(fmt.Sprintf("  --n3-primary:%s;\n", primary))
	headScripts.WriteString(fmt.Sprintf("  --n3-secondary:%s;\n", secondary))
	headScripts.WriteString(fmt.Sprintf("  --n3-accent:%s;\n", accent))
	headScripts.WriteString(fmt.Sprintf("  --n3-font-body:%s;\n", bodyFontCss))
	headScripts.WriteString(fmt.Sprintf("  --n3-font-heading:%s;\n", headingFontCss))
	headScripts.WriteString("}\n</style>\n")

	headScripts.WriteString("<script>\ntailwind.config={theme:{extend:{colors:{primary:'var(--n3-primary)',secondary:'var(--n3-secondary)',accent:'var(--n3-accent)'}}}}\n</script>\n")

	for _, s := range manifest.HeadScripts {
		headScripts.WriteString(s + "\n")
	}

	// 6. Build body scripts block (includes n3ware editor)
	var bodyScripts strings.Builder
	for _, s := range manifest.BodyScripts {
		bodyScripts.WriteString(s + "\n")
	}
	// Inject n3ware editor with site API key as fallback credential
	if manifest.APIKey != "" {
		bodyScripts.WriteString(fmt.Sprintf(
			"\n<!-- n3ware editor -->\n<script src=\"https://n3ware.com/n3ware.js\" data-n3-api=\"https://n3ware.com/api\" data-n3-site=\"%s\" data-n3-key=\"%s\"></script>\n",
			escapeHTML(manifest.ID), escapeHTML(manifest.APIKey),
		))
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

	// 8. Template processing — load collections referenced in page and render
	slugs := findReferencedCollections(html)
	if len(slugs) > 0 {
		collections := make(CollectionEntries)
		for _, slug := range slugs {
			entries, err := a.loadCollectionEntries(ctx, siteId, slug)
			if err != nil {
				log.Printf("[assembler] collection load error site=%s slug=%s: %v", siteId, slug, err)
				entries = []Entry{}
			}
			collections[slug] = entries
		}
		html = ProcessTemplate(html, &manifest, collections)
	}

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
