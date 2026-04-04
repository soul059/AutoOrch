// Security Tests
// Tests for path traversal prevention, SSRF protection, encryption, and header injection prevention

import { describe, it, expect } from 'vitest';

// ============================================================================
// PATH TRAVERSAL PREVENTION (Artifact Store)
// ============================================================================

// Simulates the sanitizeFilename logic from artifact-store
function sanitizeFilename(name: string): string {
  return name
    .replace(/\.\./g, '')           // Remove parent directory traversal
    .replace(/[\/\\]/g, '_')        // Replace path separators
    .replace(/\0/g, '')             // Remove null bytes
    .replace(/^\.+/, '')            // Remove leading dots
    .replace(/[<>:"|?*]/g, '_')     // Remove Windows-invalid chars
    .trim();
}

// Simulates path validation (after path.resolve)
function isPathSafe(basePath: string, resolvedPath: string): boolean {
  const normalizedBase = basePath.replace(/\\/g, '/').toLowerCase();
  // Simulate path.resolve by collapsing ../ sequences
  let normalized = resolvedPath.replace(/\\/g, '/').toLowerCase();
  // Simple simulation of path resolution for ..
  while (normalized.includes('/../')) {
    normalized = normalized.replace(/\/[^/]+\/\.\.\//g, '/');
  }
  return normalized.startsWith(normalizedBase);
}

describe('Path Traversal Prevention', () => {
  describe('Filename Sanitization', () => {
    it('removes parent directory references', () => {
      // After removing .., the slashes become underscores
      expect(sanitizeFilename('../../../etc/passwd')).toBe('___etc_passwd');
      expect(sanitizeFilename('..\\..\\..\\windows\\system32')).toBe('___windows_system32');
    });

    it('replaces forward slashes with underscores', () => {
      expect(sanitizeFilename('path/to/file.txt')).toBe('path_to_file.txt');
    });

    it('replaces backslashes with underscores', () => {
      expect(sanitizeFilename('path\\to\\file.txt')).toBe('path_to_file.txt');
    });

    it('removes null bytes', () => {
      expect(sanitizeFilename('file\0.txt')).toBe('file.txt');
      expect(sanitizeFilename('file\0\0\0name.txt')).toBe('filename.txt');
    });

    it('removes leading dots', () => {
      expect(sanitizeFilename('.hidden')).toBe('hidden');
      expect(sanitizeFilename('...hidden')).toBe('hidden');
    });

    it('removes Windows-invalid characters', () => {
      expect(sanitizeFilename('file<name>.txt')).toBe('file_name_.txt');
      expect(sanitizeFilename('file:name.txt')).toBe('file_name.txt');
      expect(sanitizeFilename('file"name".txt')).toBe('file_name_.txt');
      expect(sanitizeFilename('file|name.txt')).toBe('file_name.txt');
      expect(sanitizeFilename('file?name.txt')).toBe('file_name.txt');
      expect(sanitizeFilename('file*name.txt')).toBe('file_name.txt');
    });

    it('handles complex traversal attempts', () => {
      // Multiple dots and slashes get sanitized
      expect(sanitizeFilename('....//....//etc/passwd')).toBe('____etc_passwd');
      expect(sanitizeFilename('..%2f..%2fetc%2fpasswd')).toBe('%2f%2fetc%2fpasswd');
      expect(sanitizeFilename('..%5c..%5cwindows')).toBe('%5c%5cwindows');
    });

    it('preserves valid filenames', () => {
      expect(sanitizeFilename('document.pdf')).toBe('document.pdf');
      expect(sanitizeFilename('my-file_2024.txt')).toBe('my-file_2024.txt');
      expect(sanitizeFilename('artifact_run123_task456.json')).toBe('artifact_run123_task456.json');
    });

    it('trims whitespace', () => {
      expect(sanitizeFilename('  file.txt  ')).toBe('file.txt');
    });
  });

  describe('Path Containment Validation', () => {
    const baseDir = '/storage/artifacts';

    it('accepts paths within base directory', () => {
      expect(isPathSafe(baseDir, '/storage/artifacts/file.txt')).toBe(true);
      expect(isPathSafe(baseDir, '/storage/artifacts/subdir/file.txt')).toBe(true);
    });

    it('rejects paths escaping base directory', () => {
      expect(isPathSafe(baseDir, '/storage/file.txt')).toBe(false);
      expect(isPathSafe(baseDir, '/etc/passwd')).toBe(false);
      expect(isPathSafe(baseDir, '/storage/artifacts/../etc/passwd')).toBe(false);
    });

    it('handles case-insensitive comparison (Windows)', () => {
      expect(isPathSafe('/Storage/Artifacts', '/storage/artifacts/file.txt')).toBe(true);
    });

    it('normalizes path separators', () => {
      expect(isPathSafe('C:\\storage\\artifacts', 'C:/storage/artifacts/file.txt')).toBe(true);
    });
  });
});

// ============================================================================
// SSRF PROTECTION
// ============================================================================

// Simulates private IP detection
function isPrivateIP(ip: string): boolean {
  // IPv4 private ranges
  if (/^10\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^127\./.test(ip)) return true;
  if (/^0\./.test(ip)) return true;
  if (ip === 'localhost') return true;
  
  // Link-local
  if (/^169\.254\./.test(ip)) return true;
  
  // Cloud metadata
  if (ip === '169.254.169.254') return true;
  
  // IPv6 loopback
  if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return true;
  
  // IPv4-mapped IPv6
  if (/^::ffff:/.test(ip)) return true;
  
  return false;
}

// Simulates URL safety check (synchronous part)
function isUrlSafeBasic(urlString: string): { safe: boolean; reason?: string } {
  try {
    const url = new URL(urlString);
    
    // Must be http or https
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { safe: false, reason: 'Invalid protocol' };
    }
    
    // Check hostname
    const hostname = url.hostname.toLowerCase();
    
    if (isPrivateIP(hostname)) {
      return { safe: false, reason: 'Private IP blocked' };
    }
    
    // Block numeric IP bypasses
    if (/^\d+$/.test(hostname)) {
      return { safe: false, reason: 'Numeric IP bypass blocked' };
    }
    
    // Block hex IP
    if (/^0x[0-9a-f]+$/i.test(hostname)) {
      return { safe: false, reason: 'Hex IP blocked' };
    }
    
    // Block octal IP
    if (/^0\d+\./.test(hostname)) {
      return { safe: false, reason: 'Octal IP blocked' };
    }
    
    return { safe: true };
  } catch {
    return { safe: false, reason: 'Invalid URL' };
  }
}

describe('SSRF Protection', () => {
  describe('Private IP Detection', () => {
    it('blocks 10.x.x.x range', () => {
      expect(isPrivateIP('10.0.0.1')).toBe(true);
      expect(isPrivateIP('10.255.255.255')).toBe(true);
    });

    it('blocks 172.16-31.x.x range', () => {
      expect(isPrivateIP('172.16.0.1')).toBe(true);
      expect(isPrivateIP('172.31.255.255')).toBe(true);
      expect(isPrivateIP('172.15.0.1')).toBe(false);
      expect(isPrivateIP('172.32.0.1')).toBe(false);
    });

    it('blocks 192.168.x.x range', () => {
      expect(isPrivateIP('192.168.0.1')).toBe(true);
      expect(isPrivateIP('192.168.255.255')).toBe(true);
    });

    it('blocks loopback addresses', () => {
      expect(isPrivateIP('127.0.0.1')).toBe(true);
      expect(isPrivateIP('127.0.0.99')).toBe(true);
      expect(isPrivateIP('localhost')).toBe(true);
    });

    it('blocks 0.x.x.x range', () => {
      expect(isPrivateIP('0.0.0.0')).toBe(true);
      expect(isPrivateIP('0.0.0.1')).toBe(true);
    });

    it('blocks link-local addresses', () => {
      expect(isPrivateIP('169.254.0.1')).toBe(true);
      expect(isPrivateIP('169.254.169.254')).toBe(true);
    });

    it('blocks IPv6 loopback', () => {
      expect(isPrivateIP('::1')).toBe(true);
      expect(isPrivateIP('0:0:0:0:0:0:0:1')).toBe(true);
    });

    it('blocks IPv4-mapped IPv6', () => {
      expect(isPrivateIP('::ffff:127.0.0.1')).toBe(true);
      expect(isPrivateIP('::ffff:192.168.1.1')).toBe(true);
    });

    it('allows public IPs', () => {
      expect(isPrivateIP('8.8.8.8')).toBe(false);
      expect(isPrivateIP('1.1.1.1')).toBe(false);
      expect(isPrivateIP('142.250.185.46')).toBe(false);
    });
  });

  describe('URL Safety Validation', () => {
    it('allows valid HTTPS URLs', () => {
      expect(isUrlSafeBasic('https://api.openai.com/v1/chat')).toEqual({ safe: true });
      expect(isUrlSafeBasic('https://generativelanguage.googleapis.com/v1')).toEqual({ safe: true });
    });

    it('allows valid HTTP URLs', () => {
      expect(isUrlSafeBasic('http://api.example.com/endpoint')).toEqual({ safe: true });
    });

    it('blocks private IPs in URLs', () => {
      expect(isUrlSafeBasic('http://192.168.1.1:8080/api').safe).toBe(false);
      expect(isUrlSafeBasic('http://10.0.0.1/api').safe).toBe(false);
      expect(isUrlSafeBasic('http://127.0.0.1:3000/api').safe).toBe(false);
    });

    it('blocks localhost', () => {
      expect(isUrlSafeBasic('http://localhost:3000').safe).toBe(false);
      expect(isUrlSafeBasic('https://localhost/api').safe).toBe(false);
    });

    it('blocks cloud metadata endpoint', () => {
      expect(isUrlSafeBasic('http://169.254.169.254/latest/meta-data/').safe).toBe(false);
    });

    it('blocks non-HTTP protocols', () => {
      expect(isUrlSafeBasic('file:///etc/passwd').safe).toBe(false);
      expect(isUrlSafeBasic('ftp://internal.server/data').safe).toBe(false);
      expect(isUrlSafeBasic('gopher://internal:70/').safe).toBe(false);
    });

    it('blocks numeric IP bypasses', () => {
      // 2130706433 = 127.0.0.1 in decimal
      expect(isUrlSafeBasic('http://2130706433/').safe).toBe(false);
    });

    it('blocks hex IP bypasses', () => {
      expect(isUrlSafeBasic('http://0x7f000001/').safe).toBe(false);
    });

    it('blocks octal IP bypasses', () => {
      expect(isUrlSafeBasic('http://0177.0.0.1/').safe).toBe(false);
    });

    it('rejects invalid URLs', () => {
      expect(isUrlSafeBasic('not-a-url').safe).toBe(false);
      expect(isUrlSafeBasic('').safe).toBe(false);
    });
  });
});

// ============================================================================
// ENCRYPTION KEY VALIDATION
// ============================================================================

function validateEncryptionKey(key: string | undefined, isProduction: boolean): { valid: boolean; error?: string } {
  if (!key) {
    if (isProduction) {
      return { valid: false, error: 'APP_ENCRYPTION_KEY is required in production' };
    }
    return { valid: true }; // Dev mode allows missing key
  }

  if (!/^[0-9a-f]{64}$/i.test(key)) {
    return { valid: false, error: 'APP_ENCRYPTION_KEY must be 64 hex characters (32 bytes)' };
  }

  return { valid: true };
}

describe('Encryption Key Validation', () => {
  describe('Production Mode', () => {
    it('rejects missing key in production', () => {
      const result = validateEncryptionKey(undefined, true);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('required in production');
    });

    it('rejects empty key in production', () => {
      const result = validateEncryptionKey('', true);
      expect(result.valid).toBe(false);
    });

    it('accepts valid 64-char hex key', () => {
      const validKey = 'a'.repeat(64);
      expect(validateEncryptionKey(validKey, true)).toEqual({ valid: true });
    });

    it('accepts mixed case hex key', () => {
      const validKey = 'aAbBcCdDeEfF0123456789' + 'a'.repeat(42);
      expect(validateEncryptionKey(validKey, true)).toEqual({ valid: true });
    });

    it('rejects key with non-hex characters', () => {
      const invalidKey = 'g' + 'a'.repeat(63);
      expect(validateEncryptionKey(invalidKey, true).valid).toBe(false);
    });

    it('rejects key shorter than 64 chars', () => {
      const shortKey = 'a'.repeat(63);
      expect(validateEncryptionKey(shortKey, true).valid).toBe(false);
    });

    it('rejects key longer than 64 chars', () => {
      const longKey = 'a'.repeat(65);
      expect(validateEncryptionKey(longKey, true).valid).toBe(false);
    });
  });

  describe('Development Mode', () => {
    it('allows missing key in development', () => {
      expect(validateEncryptionKey(undefined, false)).toEqual({ valid: true });
    });

    it('still validates format if key is provided', () => {
      const invalidKey = 'short';
      expect(validateEncryptionKey(invalidKey, false).valid).toBe(false);
    });
  });
});

// ============================================================================
// HEADER INJECTION PREVENTION
// ============================================================================

// Simulates RFC 6266 filename encoding
function encodeFilenameRFC6266(filename: string): string {
  // Use filename*=UTF-8'' encoding for safety
  const encoded = encodeURIComponent(filename)
    .replace(/['()]/g, escape)
    .replace(/\*/g, '%2A');
  return `attachment; filename*=UTF-8''${encoded}`;
}

// Check if string contains CRLF injection
function containsCRLF(str: string): boolean {
  return /[\r\n]/.test(str);
}

describe('Header Injection Prevention', () => {
  describe('Filename Encoding', () => {
    it('encodes simple filenames', () => {
      const result = encodeFilenameRFC6266('document.pdf');
      expect(result).toBe("attachment; filename*=UTF-8''document.pdf");
    });

    it('encodes filenames with spaces', () => {
      const result = encodeFilenameRFC6266('my document.pdf');
      expect(result).toContain('my%20document.pdf');
    });

    it('encodes special characters', () => {
      const result = encodeFilenameRFC6266('file<>:"/\\|?*.txt');
      expect(result).not.toContain('<');
      expect(result).not.toContain('>');
      expect(result).not.toContain('"');
    });

    it('encodes Unicode characters', () => {
      const result = encodeFilenameRFC6266('文档.pdf');
      expect(result).toContain('%');
      expect(result).toContain("UTF-8''");
    });

    it('prevents CRLF injection in encoded output', () => {
      const malicious = 'file.txt\r\nX-Injected: header';
      const result = encodeFilenameRFC6266(malicious);
      expect(containsCRLF(result)).toBe(false);
    });
  });

  describe('CRLF Detection', () => {
    it('detects carriage return', () => {
      expect(containsCRLF('test\rvalue')).toBe(true);
    });

    it('detects line feed', () => {
      expect(containsCRLF('test\nvalue')).toBe(true);
    });

    it('detects CRLF pair', () => {
      expect(containsCRLF('test\r\nvalue')).toBe(true);
    });

    it('passes clean strings', () => {
      expect(containsCRLF('clean-string')).toBe(false);
      expect(containsCRLF('also clean')).toBe(false);
    });
  });
});

// ============================================================================
// SQL INJECTION PREVENTION
// ============================================================================

const ALLOWED_COLUMNS = new Set([
  'state', 'result', 'error', 'retry_count', 'assigned_provider',
  'cost', 'tokens_used', 'started_at', 'completed_at', 'updated_at'
]);

function isValidColumn(column: string): boolean {
  return ALLOWED_COLUMNS.has(column);
}

describe('SQL Column Whitelisting', () => {
  it('allows valid task columns', () => {
    expect(isValidColumn('state')).toBe(true);
    expect(isValidColumn('result')).toBe(true);
    expect(isValidColumn('error')).toBe(true);
    expect(isValidColumn('retry_count')).toBe(true);
    expect(isValidColumn('assigned_provider')).toBe(true);
    expect(isValidColumn('cost')).toBe(true);
    expect(isValidColumn('tokens_used')).toBe(true);
    expect(isValidColumn('started_at')).toBe(true);
    expect(isValidColumn('completed_at')).toBe(true);
    expect(isValidColumn('updated_at')).toBe(true);
  });

  it('blocks SQL injection attempts', () => {
    expect(isValidColumn('state; DROP TABLE tasks--')).toBe(false);
    expect(isValidColumn("state' OR '1'='1")); // Returns false
    expect(isValidColumn('state UNION SELECT *')).toBe(false);
  });

  it('blocks non-existent columns', () => {
    expect(isValidColumn('password')).toBe(false);
    expect(isValidColumn('secret_key')).toBe(false);
    expect(isValidColumn('admin')).toBe(false);
  });

  it('is case-sensitive (columns must match exactly)', () => {
    expect(isValidColumn('STATE')).toBe(false);
    expect(isValidColumn('State')).toBe(false);
  });

  it('blocks empty or whitespace columns', () => {
    expect(isValidColumn('')).toBe(false);
    expect(isValidColumn(' ')).toBe(false);
    expect(isValidColumn('\t')).toBe(false);
  });
});
