/**
 * Secure Keys Service
 *
 * Manages temporary in-memory storage of API keys and tokens detected in chat messages.
 * Keys are never persisted to disk or transcripts - only stored in memory during the session.
 *
 * Security features:
 * - Memory-only storage (cleared on app restart)
 * - Session-scoped (keys tied to session ID)
 * - Automatic cleanup on session end
 * - No logging of actual key values
 */

import { randomBytes } from 'crypto';

export interface SecureKey {
  id: string;           // Reference ID (e.g., "key_abc123")
  sessionId: string;    // Session this key belongs to
  type: string;         // Key type (e.g., "anthropic", "openai", "github")
  value: string;        // The actual key value (never logged or persisted)
  detectedAt: number;   // Timestamp when detected
  lastAccessedAt: number | null; // Last time agent accessed this key
}

export class SecureKeysService {
  // In-memory storage only - never persisted
  private keys = new Map<string, SecureKey>();

  // Key type detection patterns
  private readonly KEY_PATTERNS = [
    { type: 'anthropic', pattern: /\bsk-ant-[a-zA-Z0-9_-]{95,105}\b/g, description: 'Anthropic API Key' },
    { type: 'openai', pattern: /\bsk-[a-zA-Z0-9]{48,}\b/g, description: 'OpenAI API Key' },
    { type: 'github_token', pattern: /\bghp_[a-zA-Z0-9]{36,}\b/g, description: 'GitHub Personal Access Token' },
    { type: 'github_oauth', pattern: /\bgho_[a-zA-Z0-9]{36,}\b/g, description: 'GitHub OAuth Token' },
    { type: 'github_app', pattern: /\b(ghu|ghs)_[a-zA-Z0-9]{36,}\b/g, description: 'GitHub App Token' },
    { type: 'aws_access_key', pattern: /\bAKIA[0-9A-Z]{16}\b/g, description: 'AWS Access Key' },
    { type: 'aws_secret_key', pattern: /\b[A-Za-z0-9/+=]{40}\b/g, description: 'AWS Secret Key' },
    { type: 'stripe', pattern: /\bsk_(live|test)_[a-zA-Z0-9]{24,}\b/g, description: 'Stripe API Key' },
    { type: 'twilio', pattern: /\bSK[a-z0-9]{32}\b/g, description: 'Twilio API Key' },
    { type: 'google_api', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g, description: 'Google API Key' },
    { type: 'slack', pattern: /\bxox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24,}\b/g, description: 'Slack Token' },
    { type: 'bearer', pattern: /\bBearer\s+[a-zA-Z0-9_-]{20,}\b/gi, description: 'Bearer Token' },
    { type: 'jwt', pattern: /\beyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g, description: 'JWT Token' },
  ];

  /**
   * Detect and extract API keys from text
   * Returns array of detected keys with their types
   */
  detectKeys(text: string): Array<{ value: string; type: string; description: string }> {
    const detected: Array<{ value: string; type: string; description: string }> = [];

    for (const { type, pattern, description } of this.KEY_PATTERNS) {
      const matches = text.match(pattern);
      if (matches) {
        for (const value of matches) {
          // Skip if already detected (avoid duplicates)
          if (!detected.find(k => k.value === value)) {
            detected.push({ value, type, description });
          }
        }
      }
    }

    return detected;
  }

  /**
   * Store a key securely and return reference ID
   */
  storeKey(sessionId: string, keyValue: string, keyType: string): string {
    const id = this.generateKeyId();

    const secureKey: SecureKey = {
      id,
      sessionId,
      type: keyType,
      value: keyValue,
      detectedAt: Date.now(),
      lastAccessedAt: null,
    };

    this.keys.set(id, secureKey);
    console.log(`[SecureKeys] Stored ${keyType} key with ID ${id} for session ${sessionId}`);

    return id;
  }

  /**
   * Retrieve a key by its reference ID
   * Updates lastAccessedAt timestamp
   */
  getKey(keyId: string): string | null {
    const key = this.keys.get(keyId);
    if (!key) {
      console.warn(`[SecureKeys] Key ${keyId} not found`);
      return null;
    }

    key.lastAccessedAt = Date.now();
    console.log(`[SecureKeys] Key ${keyId} (${key.type}) accessed by session ${key.sessionId}`);

    return key.value;
  }

  /**
   * Get all key IDs for a session (without revealing actual values)
   */
  getSessionKeys(sessionId: string): Array<{ id: string; type: string; description: string }> {
    const sessionKeys: Array<{ id: string; type: string; description: string }> = [];

    for (const key of this.keys.values()) {
      if (key.sessionId === sessionId) {
        const pattern = this.KEY_PATTERNS.find(p => p.type === key.type);
        sessionKeys.push({
          id: key.id,
          type: key.type,
          description: pattern?.description || key.type,
        });
      }
    }

    return sessionKeys;
  }

  /**
   * Process message text: detect keys, store them, and replace with placeholders
   * Returns modified text and info about detected keys
   */
  interceptAndReplaceKeys(
    sessionId: string,
    text: string
  ): { modifiedText: string; keysDetected: Array<{ id: string; type: string; description: string }> } {
    const detected = this.detectKeys(text);

    if (detected.length === 0) {
      return { modifiedText: text, keysDetected: [] };
    }

    let modifiedText = text;
    const keysDetected: Array<{ id: string; type: string; description: string }> = [];

    // Store each key and replace with placeholder
    for (const { value, type, description } of detected) {
      const keyId = this.storeKey(sessionId, value, type);

      // Replace the actual key with a secure placeholder
      // The agent can retrieve it via tool call if needed
      const placeholder = `[SECURE_KEY:${keyId}]`;
      modifiedText = modifiedText.replace(value, placeholder);

      keysDetected.push({ id: keyId, type, description });
    }

    console.log(`[SecureKeys] Intercepted ${keysDetected.length} key(s) in session ${sessionId}`);

    return { modifiedText, keysDetected };
  }

  /**
   * Clear all keys for a session (called when session ends)
   */
  clearSessionKeys(sessionId: string): void {
    let cleared = 0;

    for (const [id, key] of this.keys.entries()) {
      if (key.sessionId === sessionId) {
        this.keys.delete(id);
        cleared++;
      }
    }

    if (cleared > 0) {
      console.log(`[SecureKeys] Cleared ${cleared} key(s) for session ${sessionId}`);
    }
  }

  /**
   * Clear all keys (called on app shutdown)
   */
  clearAllKeys(): void {
    const count = this.keys.size;
    this.keys.clear();
    console.log(`[SecureKeys] Cleared all ${count} stored key(s)`);
  }

  /**
   * Get statistics (for debugging, never exposes actual keys)
   */
  getStats(): { totalKeys: number; keysByType: Record<string, number> } {
    const keysByType: Record<string, number> = {};

    for (const key of this.keys.values()) {
      keysByType[key.type] = (keysByType[key.type] || 0) + 1;
    }

    return {
      totalKeys: this.keys.size,
      keysByType,
    };
  }

  /**
   * Generate a unique key ID
   */
  private generateKeyId(): string {
    return `key_${randomBytes(8).toString('hex')}`;
  }
}

// Singleton instance
export const secureKeysService = new SecureKeysService();
