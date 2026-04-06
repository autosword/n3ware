package main

import (
	"encoding/json"
	"fmt"
	"html"
	"math"
	"sort"
	"strconv"
	"strings"
)

// Entry represents a single collection entry loaded from GCS.
type Entry struct {
	ID           string                 `json:"id"`
	CollectionID string                 `json:"collectionId"`
	Data         map[string]interface{} `json:"data"`
	CreatedAt    string                 `json:"createdAt"`
	UpdatedAt    string                 `json:"updatedAt"`
}

// CollectionEntries maps collection slug → slice of entries (sorted).
type CollectionEntries map[string][]Entry

// ProcessTemplate renders Handlebars-style template directives in HTML.
// Supported:
//
//	{{variable}}               — HTML-escaped value from current context
//	{{{variable}}}             — unescaped value
//	{{#each slug}}...{{/each}} — loop over collection entries
//	{{#each slug limit=N sort="field:dir"}}...{{/each}}
//	{{#if field}}...{{/if}}    — conditional
//	{{#if field}}...{{else}}...{{/if}}
//	{{this.fieldKey}}          — entry field in loop context
//	{{site.name}}              — site-level fields from manifest
//	{{site.theme.colors.primary}}
//	{{slug.count}}             — entry count for a collection
func ProcessTemplate(htmlStr string, manifest *SiteManifest, collections CollectionEntries) string {
	ctx := &templateContext{
		manifest:    manifest,
		collections: collections,
		vars:        map[string]interface{}{},
	}
	return ctx.process(htmlStr)
}

type templateContext struct {
	manifest    *SiteManifest
	collections CollectionEntries
	vars        map[string]interface{} // current loop entry data
}

func (c *templateContext) process(s string) string {
	var buf strings.Builder
	i := 0
	for i < len(s) {
		// Look for {{
		j := strings.Index(s[i:], "{{")
		if j < 0 {
			buf.WriteString(s[i:])
			break
		}
		buf.WriteString(s[i : i+j])
		i += j

		// Determine if triple-brace {{{
		triple := i+2 < len(s) && s[i+2] == '{'
		openLen := 2
		closeStr := "}}"
		if triple {
			openLen = 3
			closeStr = "}}}"
		}

		// Find closing braces
		k := strings.Index(s[i+openLen:], closeStr)
		if k < 0 {
			// No closing — emit as-is and stop
			buf.WriteString(s[i:])
			break
		}
		inner := strings.TrimSpace(s[i+openLen : i+openLen+k])
		tokenEnd := i + openLen + k + len(closeStr)

		if strings.HasPrefix(inner, "#each ") {
			// Block directive — find matching {{/each}}
			slug, limitN, sortStr := parseEachParams(inner[6:])
			blockContent, afterBlock := extractBlock(s[tokenEnd:], "each")
			rendered := c.renderEach(slug, limitN, sortStr, blockContent)
			buf.WriteString(rendered)
			i = tokenEnd + afterBlock
		} else if strings.HasPrefix(inner, "#if ") {
			field := strings.TrimSpace(inner[4:])
			blockContent, elseContent, afterBlock := extractIfBlock(s[tokenEnd:])
			if c.isTruthy(field) {
				buf.WriteString(c.process(blockContent))
			} else if elseContent != "" {
				buf.WriteString(c.process(elseContent))
			}
			i = tokenEnd + afterBlock
		} else if inner == "/each" || inner == "/if" || inner == "else" {
			// Stray close tag — skip
			i = tokenEnd
		} else {
			// Variable substitution
			val := c.resolve(inner)
			str := fmt.Sprintf("%v", val)
			if triple {
				buf.WriteString(str)
			} else {
				buf.WriteString(html.EscapeString(str))
			}
			i = tokenEnd
		}
	}
	return buf.String()
}

func (c *templateContext) renderEach(slug string, limitN int, sortStr string, blockTemplate string) string {
	entries, ok := c.collections[slug]
	if !ok {
		return ""
	}

	// Sort
	sorted := make([]Entry, len(entries))
	copy(sorted, entries)
	if sortStr != "" {
		parts := strings.SplitN(sortStr, ":", 2)
		field := parts[0]
		dir := "asc"
		if len(parts) == 2 {
			dir = strings.ToLower(parts[1])
		}
		sort.SliceStable(sorted, func(i, j int) bool {
			vi := fmt.Sprintf("%v", sorted[i].Data[field])
			vj := fmt.Sprintf("%v", sorted[j].Data[field])
			if dir == "desc" {
				return vi > vj
			}
			return vi < vj
		})
	}

	// Limit
	if limitN > 0 && limitN < len(sorted) {
		sorted = sorted[:limitN]
	}

	var buf strings.Builder
	for _, entry := range sorted {
		child := &templateContext{
			manifest:    c.manifest,
			collections: c.collections,
			vars:        entry.Data,
		}
		buf.WriteString(child.process(blockTemplate))
	}
	return buf.String()
}

func (c *templateContext) isTruthy(field string) bool {
	val := c.resolve(field)
	if val == nil {
		return false
	}
	switch v := val.(type) {
	case bool:
		return v
	case string:
		return v != "" && v != "false" && v != "0"
	case float64:
		return v != 0 && !math.IsNaN(v)
	case int:
		return v != 0
	default:
		return true
	}
}

func (c *templateContext) resolve(path string) interface{} {
	parts := strings.SplitN(path, ".", 2)
	head := parts[0]

	// this.field — current loop entry
	if head == "this" && len(parts) == 2 {
		return c.vars[parts[1]]
	}

	// site.* — manifest fields
	if head == "site" {
		if len(parts) == 1 {
			return c.manifest.Name
		}
		return resolveSiteField(c.manifest, parts[1])
	}

	// slug.count — collection entry count
	if len(parts) == 2 && parts[1] == "count" {
		if entries, ok := c.collections[head]; ok {
			return len(entries)
		}
		return 0
	}

	// Direct var lookup (loop context)
	if val, ok := c.vars[head]; ok {
		return val
	}

	return ""
}

func resolveSiteField(m *SiteManifest, path string) interface{} {
	// Marshal manifest to map for generic traversal
	b, err := json.Marshal(m)
	if err != nil {
		return ""
	}
	var obj map[string]interface{}
	if err := json.Unmarshal(b, &obj); err != nil {
		return ""
	}
	return deepGet(obj, strings.Split(path, "."))
}

func deepGet(obj map[string]interface{}, keys []string) interface{} {
	if len(keys) == 0 {
		return nil
	}
	val, ok := obj[keys[0]]
	if !ok {
		return ""
	}
	if len(keys) == 1 {
		return val
	}
	if nested, ok := val.(map[string]interface{}); ok {
		return deepGet(nested, keys[1:])
	}
	return ""
}

// parseEachParams parses "team limit=3 sort=\"date:desc\"" → slug, limit, sort
func parseEachParams(s string) (slug string, limit int, sortStr string) {
	fields := strings.Fields(s)
	if len(fields) == 0 {
		return "", 0, ""
	}
	slug = fields[0]
	for _, f := range fields[1:] {
		if strings.HasPrefix(f, "limit=") {
			n, _ := strconv.Atoi(strings.TrimPrefix(f, "limit="))
			limit = n
		} else if strings.HasPrefix(f, "sort=") {
			sortStr = strings.Trim(strings.TrimPrefix(f, "sort="), "\"'")
		}
	}
	return
}

// extractBlock finds content between current position and {{/tag}}.
// Returns (blockContent, bytesConsumed).
func extractBlock(s string, tag string) (string, int) {
	open := "{{#" + tag
	close := "{{/" + tag + "}}"
	depth := 1
	i := 0
	for i < len(s) {
		if strings.HasPrefix(s[i:], close) && depth == 1 {
			return s[:i], i + len(close)
		}
		if strings.HasPrefix(s[i:], open) {
			depth++
			i += len(open)
			continue
		}
		if strings.HasPrefix(s[i:], "{{/"+tag) && depth > 1 {
			depth--
		}
		i++
	}
	return s, len(s)
}

// extractIfBlock finds content between current position and {{/if}},
// splitting on {{else}} at depth 1.
// Returns (ifContent, elseContent, bytesConsumed).
func extractIfBlock(s string) (string, string, int) {
	const openTag = "{{#if "
	const closeTag = "{{/if}}"
	const elseTag = "{{else}}"
	depth := 1
	i := 0
	elsePos := -1

	for i < len(s) {
		if strings.HasPrefix(s[i:], closeTag) && depth == 1 {
			if elsePos >= 0 {
				return s[:elsePos], s[elsePos+len(elseTag) : i], i + len(closeTag)
			}
			return s[:i], "", i + len(closeTag)
		}
		if strings.HasPrefix(s[i:], openTag) {
			depth++
			i += len(openTag)
			continue
		}
		if strings.HasPrefix(s[i:], "{{/if") && depth > 1 {
			depth--
		}
		if strings.HasPrefix(s[i:], elseTag) && depth == 1 {
			elsePos = i
			i += len(elseTag)
			continue
		}
		i++
	}
	return s, "", len(s)
}
