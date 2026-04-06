package main

import (
	"strings"
	"testing"
)

func makeManifest(name string) *SiteManifest {
	m := &SiteManifest{
		ID:   "test-site",
		Name: name,
	}
	m.Theme.Colors.Primary = "#3B82F6"
	m.Theme.Colors.Secondary = "#8B5CF6"
	m.Theme.Colors.Accent = "#F59E0B"
	return m
}

func makeCollections(entries map[string][]Entry) CollectionEntries {
	return CollectionEntries(entries)
}

func TestVariableEscaping(t *testing.T) {
	m := makeManifest("Test Site")
	c := makeCollections(nil)
	out := ProcessTemplate(`Hello {{name}}`, m, c)
	// name not in context — should be empty
	if out != "Hello " {
		t.Errorf("expected 'Hello ' got %q", out)
	}
}

func TestVariableHTMLEscaping(t *testing.T) {
	m := makeManifest("Test Site")
	entries := []Entry{{ID: "1", Data: map[string]interface{}{"name": "<script>alert(1)</script>"}}}
	c := makeCollections(map[string][]Entry{"team": entries})
	out := ProcessTemplate(`{{#each team}}{{this.name}}{{/each}}`, m, c)
	if strings.Contains(out, "<script>") {
		t.Error("HTML not escaped in {{variable}}")
	}
	if !strings.Contains(out, "&lt;script&gt;") {
		t.Errorf("Expected escaped output, got: %q", out)
	}
}

func TestTripleBraceNoEscape(t *testing.T) {
	m := makeManifest("Test Site")
	entries := []Entry{{ID: "1", Data: map[string]interface{}{"body": "<strong>bold</strong>"}}}
	c := makeCollections(map[string][]Entry{"posts": entries})
	out := ProcessTemplate(`{{#each posts}}{{{this.body}}}{{/each}}`, m, c)
	if !strings.Contains(out, "<strong>bold</strong>") {
		t.Errorf("Expected unescaped HTML, got: %q", out)
	}
}

func TestEachLoop(t *testing.T) {
	m := makeManifest("Test")
	entries := []Entry{
		{ID: "1", Data: map[string]interface{}{"name": "Alice"}},
		{ID: "2", Data: map[string]interface{}{"name": "Bob"}},
		{ID: "3", Data: map[string]interface{}{"name": "Carol"}},
	}
	c := makeCollections(map[string][]Entry{"team": entries})
	out := ProcessTemplate(`{{#each team}}<p>{{this.name}}</p>{{/each}}`, m, c)
	if !strings.Contains(out, "<p>Alice</p>") || !strings.Contains(out, "<p>Bob</p>") || !strings.Contains(out, "<p>Carol</p>") {
		t.Errorf("Each loop didn't render all entries: %q", out)
	}
}

func TestEachLimit(t *testing.T) {
	m := makeManifest("Test")
	entries := []Entry{
		{ID: "1", Data: map[string]interface{}{"name": "Alice"}},
		{ID: "2", Data: map[string]interface{}{"name": "Bob"}},
		{ID: "3", Data: map[string]interface{}{"name": "Carol"}},
	}
	c := makeCollections(map[string][]Entry{"team": entries})
	out := ProcessTemplate(`{{#each team limit=2}}<p>{{this.name}}</p>{{/each}}`, m, c)
	if strings.Contains(out, "Carol") {
		t.Error("limit=2 should have excluded Carol")
	}
	if !strings.Contains(out, "Alice") || !strings.Contains(out, "Bob") {
		t.Error("limit=2 should include Alice and Bob")
	}
}

func TestIfTruthy(t *testing.T) {
	m := makeManifest("Test")
	entries := []Entry{{ID: "1", Data: map[string]interface{}{"featured": true, "name": "Alice"}}}
	c := makeCollections(map[string][]Entry{"team": entries})
	out := ProcessTemplate(`{{#each team}}{{#if this.featured}}<b>{{this.name}}</b>{{/if}}{{/each}}`, m, c)
	if !strings.Contains(out, "<b>Alice</b>") {
		t.Errorf("if truthy failed: %q", out)
	}
}

func TestIfFalsy(t *testing.T) {
	m := makeManifest("Test")
	entries := []Entry{{ID: "1", Data: map[string]interface{}{"featured": false, "name": "Bob"}}}
	c := makeCollections(map[string][]Entry{"team": entries})
	out := ProcessTemplate(`{{#each team}}{{#if this.featured}}<b>{{this.name}}</b>{{/if}}{{/each}}`, m, c)
	if strings.Contains(out, "<b>Bob</b>") {
		t.Error("if falsy should not render block")
	}
}

func TestIfElse(t *testing.T) {
	m := makeManifest("Test")
	entries := []Entry{{ID: "1", Data: map[string]interface{}{"featured": false, "name": "Bob"}}}
	c := makeCollections(map[string][]Entry{"team": entries})
	out := ProcessTemplate(`{{#each team}}{{#if this.featured}}<b>{{this.name}}</b>{{else}}<span>{{this.name}}</span>{{/if}}{{/each}}`, m, c)
	if !strings.Contains(out, "<span>Bob</span>") {
		t.Errorf("else branch failed: %q", out)
	}
}

func TestSiteName(t *testing.T) {
	m := makeManifest("My Awesome Site")
	c := makeCollections(nil)
	out := ProcessTemplate(`<title>{{site.name}}</title>`, m, c)
	if out != "<title>My Awesome Site</title>" {
		t.Errorf("site.name failed: %q", out)
	}
}

func TestSiteThemeColor(t *testing.T) {
	m := makeManifest("Test")
	c := makeCollections(nil)
	out := ProcessTemplate(`color: {{site.theme.colors.primary}}`, m, c)
	if !strings.Contains(out, "#3B82F6") {
		t.Errorf("site.theme.colors.primary failed: %q", out)
	}
}

func TestSlugCount(t *testing.T) {
	m := makeManifest("Test")
	entries := []Entry{
		{ID: "1", Data: map[string]interface{}{}},
		{ID: "2", Data: map[string]interface{}{}},
		{ID: "3", Data: map[string]interface{}{}},
	}
	c := makeCollections(map[string][]Entry{"team": entries})
	out := ProcessTemplate(`{{team.count}} members`, m, c)
	if out != "3 members" {
		t.Errorf("slug.count failed: %q", out)
	}
}

func TestNestedIfInEach(t *testing.T) {
	m := makeManifest("Test")
	entries := []Entry{
		{ID: "1", Data: map[string]interface{}{"name": "Alice", "vip": true}},
		{ID: "2", Data: map[string]interface{}{"name": "Bob", "vip": false}},
	}
	c := makeCollections(map[string][]Entry{"team": entries})
	out := ProcessTemplate(`{{#each team}}{{#if this.vip}}VIP:{{this.name}}{{/if}}{{/each}}`, m, c)
	if !strings.Contains(out, "VIP:Alice") {
		t.Errorf("nested if in each failed: %q", out)
	}
	if strings.Contains(out, "VIP:Bob") {
		t.Error("nested if should not render Bob as VIP")
	}
}
