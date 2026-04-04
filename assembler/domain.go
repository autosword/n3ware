package main

import (
	"context"
	"fmt"

	"cloud.google.com/go/firestore"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// FirestoreClient wraps the Firestore client for domain resolution.
type FirestoreClient struct {
	client *firestore.Client
}

// NewFirestoreClient creates a new Firestore client for the given project.
func NewFirestoreClient(ctx context.Context, projectId string) (*FirestoreClient, error) {
	client, err := firestore.NewClient(ctx, projectId)
	if err != nil {
		return nil, fmt.Errorf("firestore.NewClient: %w", err)
	}
	return &FirestoreClient{client: client}, nil
}

// Close closes the Firestore client.
func (f *FirestoreClient) Close() error {
	return f.client.Close()
}

// DomainResolver resolves hostnames to site IDs via Firestore.
type DomainResolver struct {
	fs *FirestoreClient
}

// domainDoc is the Firestore document shape for domain mappings.
type domainDoc struct {
	SiteId string `firestore:"siteId"`
	Domain string `firestore:"domain"`
}

// Resolve looks up a hostname in Firestore and returns the associated siteId.
// Checks:
//  1. domains/{host} collection
//  2. Subdomain pattern: {subdomain}.n3ware.com → sites where name == subdomain
func (d *DomainResolver) Resolve(ctx context.Context, host string) (string, error) {
	// 1. Exact match in domains collection
	doc, err := d.fs.client.Collection("domains").Doc(host).Get(ctx)
	if err == nil && doc.Exists() {
		var dd domainDoc
		if err := doc.DataTo(&dd); err == nil && dd.SiteId != "" {
			return dd.SiteId, nil
		}
	}

	// 2. Not a Firestore "not found" error → propagate
	if err != nil && status.Code(err) != codes.NotFound {
		return "", fmt.Errorf("domain lookup %s: %w", host, err)
	}

	// 3. Subdomain pattern: {siteId}.n3ware.com
	const suffix = ".n3ware.com"
	if len(host) > len(suffix) && host[len(host)-len(suffix):] == suffix {
		subdomain := host[:len(host)-len(suffix)]
		// subdomain is treated as siteId directly for v2 sites
		return subdomain, nil
	}

	return "", nil
}
