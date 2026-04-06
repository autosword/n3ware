package main

import (
	"context"
	"fmt"
	"io"
	"strings"

	"cloud.google.com/go/storage"
	"google.golang.org/api/iterator"
	"google.golang.org/api/option"
)

// GCSClient wraps the Google Cloud Storage client for reading site files.
type GCSClient struct {
	client *storage.Client
	bucket string
}

// NewGCSClient creates a new GCS client for the given bucket.
func NewGCSClient(ctx context.Context, bucket string) (*GCSClient, error) {
	client, err := storage.NewClient(ctx, option.WithoutAuthentication())
	if err != nil {
		// Retry with application default credentials
		client, err = storage.NewClient(ctx)
		if err != nil {
			return nil, fmt.Errorf("storage.NewClient: %w", err)
		}
	}
	return &GCSClient{client: client, bucket: bucket}, nil
}

// ReadFile reads the full contents of an object from GCS.
// Returns the byte slice, or an error if the object doesn't exist.
func (g *GCSClient) ReadFile(ctx context.Context, objectPath string) ([]byte, error) {
	obj := g.client.Bucket(g.bucket).Object(objectPath)
	rc, err := obj.NewReader(ctx)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", objectPath, err)
	}
	defer rc.Close()

	data, err := io.ReadAll(rc)
	if err != nil {
		return nil, fmt.Errorf("read body %s: %w", objectPath, err)
	}
	return data, nil
}

// ReadFileOrEmpty reads a file from GCS and returns empty bytes if it doesn't exist.
func (g *GCSClient) ReadFileOrEmpty(ctx context.Context, objectPath string) []byte {
	data, err := g.ReadFile(ctx, objectPath)
	if err != nil {
		return []byte{}
	}
	return data
}

// ListFiles lists object paths under the given prefix.
// Returns only direct children (paths that don't contain a slash after the prefix).
func (g *GCSClient) ListFiles(ctx context.Context, prefix string) ([]string, error) {
	it := g.client.Bucket(g.bucket).Objects(ctx, &storage.Query{Prefix: prefix})
	var paths []string
	for {
		attrs, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("list %s: %w", prefix, err)
		}
		// Only include direct children (no further slash after prefix)
		rest := attrs.Name[len(prefix):]
		if rest == "" || strings.Contains(rest, "/") {
			continue
		}
		paths = append(paths, attrs.Name)
	}
	return paths, nil
}

// Close closes the underlying GCS client.
func (g *GCSClient) Close() error {
	return g.client.Close()
}
