const DEFAULT_MAX_ENTRIES = 1000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

class TTLCache {
  constructor({ maxEntries = DEFAULT_MAX_ENTRIES, sweepIntervalMs = SWEEP_INTERVAL_MS } = {}) {
    this._store = new Map();
    this._maxEntries = maxEntries;

    // Expired entries were only dropped on read, so cold keys leaked forever.
    this._timer = setInterval(() => this.sweep(), sweepIntervalMs);
    if (typeof this._timer.unref === "function") this._timer.unref();
  }

  set(key, value, ttlMs) {
    if (this._store.size >= this._maxEntries && !this._store.has(key)) {
      this.sweep();
      if (this._store.size >= this._maxEntries) {
        // Map preserves insertion order, so the first key is the oldest.
        this._store.delete(this._store.keys().next().value);
      }
    }
    this._store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  get(key) {
    const entry = this._store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this._store.delete(key);
      return null;
    }
    return entry.value;
  }

  delete(key) {
    this._store.delete(key);
  }

  sweep() {
    const now = Date.now();
    for (const [key, entry] of this._store) {
      if (now > entry.expiresAt) this._store.delete(key);
    }
  }

  get size() {
    return this._store.size;
  }
}

module.exports = new TTLCache();
module.exports.TTLCache = TTLCache;
