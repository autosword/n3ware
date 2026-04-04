package main

import (
	"container/list"
	"sync"
	"time"
)

// entry is one item in the LRU cache.
type entry struct {
	key       string
	value     string
	expiresAt time.Time
}

// LRUCache is a thread-safe in-memory LRU cache with TTL expiry.
type LRUCache struct {
	mu      sync.Mutex
	cap     int
	ttl     time.Duration
	ll      *list.List
	items   map[string]*list.Element
}

// NewLRUCache creates a new LRU cache with the given capacity and TTL in seconds.
func NewLRUCache(capacity int, ttlSeconds int) *LRUCache {
	return &LRUCache{
		cap:   capacity,
		ttl:   time.Duration(ttlSeconds) * time.Second,
		ll:    list.New(),
		items: make(map[string]*list.Element, capacity),
	}
}

// Get retrieves a value from the cache. Returns ("", false) if not found or expired.
func (c *LRUCache) Get(key string) (string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	el, ok := c.items[key]
	if !ok {
		return "", false
	}

	e := el.Value.(*entry)
	if time.Now().After(e.expiresAt) {
		// Expired — evict
		c.ll.Remove(el)
		delete(c.items, key)
		return "", false
	}

	// Move to front (most recently used)
	c.ll.MoveToFront(el)
	return e.value, true
}

// Set stores a value in the cache, evicting the LRU entry if at capacity.
func (c *LRUCache) Set(key, value string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Update existing
	if el, ok := c.items[key]; ok {
		c.ll.MoveToFront(el)
		el.Value.(*entry).value = value
		el.Value.(*entry).expiresAt = time.Now().Add(c.ttl)
		return
	}

	// Evict LRU if at capacity
	if c.ll.Len() >= c.cap {
		oldest := c.ll.Back()
		if oldest != nil {
			c.ll.Remove(oldest)
			delete(c.items, oldest.Value.(*entry).key)
		}
	}

	e := &entry{key: key, value: value, expiresAt: time.Now().Add(c.ttl)}
	el := c.ll.PushFront(e)
	c.items[key] = el
}

// Delete removes a key from the cache.
func (c *LRUCache) Delete(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if el, ok := c.items[key]; ok {
		c.ll.Remove(el)
		delete(c.items, key)
	}
}

// Len returns the number of items currently in the cache.
func (c *LRUCache) Len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.ll.Len()
}
