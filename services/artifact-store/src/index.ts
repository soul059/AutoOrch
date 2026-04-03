import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

export interface ArtifactMetadata {
  id: string;
  runId: string;
  taskId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  createdAt: Date;
}

export interface ArtifactUpload {
  runId: string;
  taskId: string;
  name: string;
  mimeType: string;
  content: Buffer | string;
}

export class ArtifactStore {
  private pool: Pool;
  private storagePath: string;

  constructor(pool: Pool, storagePath?: string) {
    this.pool = pool;
    this.storagePath = storagePath || process.env.ARTIFACT_STORAGE_PATH || './artifacts';
  }

  // Sanitize filename to prevent path traversal attacks
  private sanitizeFilename(name: string): string {
    // Remove any path separators and traversal sequences
    const sanitized = name
      .replace(/[\/\\]/g, '_')        // Replace path separators
      .replace(/\.\./g, '_')          // Replace traversal sequences
      .replace(/^\.+/, '')            // Remove leading dots
      .replace(/[<>:"|?*\x00-\x1f]/g, '_'); // Remove invalid chars
    
    // Ensure non-empty and reasonable length
    if (!sanitized || sanitized.length === 0) {
      return 'unnamed_artifact';
    }
    return sanitized.slice(0, 255); // Limit length
  }

  // Validate that resolved path is within storage directory
  private validatePath(filePath: string): void {
    const resolvedPath = path.resolve(filePath);
    const resolvedStorage = path.resolve(this.storagePath);
    if (!resolvedPath.startsWith(resolvedStorage)) {
      throw new Error('Path traversal detected: artifact path outside storage directory');
    }
  }

  // Store an artifact (writes to local FS and records metadata in DB)
  async store(upload: ArtifactUpload): Promise<ArtifactMetadata> {
    const id = uuidv4();
    const safeName = this.sanitizeFilename(upload.name);
    const runDir = path.join(this.storagePath, upload.runId);
    const taskDir = path.join(runDir, upload.taskId);
    const filePath = path.join(taskDir, `${id}_${safeName}`);

    // Validate path is within storage directory
    this.validatePath(filePath);

    // Ensure directories exist
    fs.mkdirSync(taskDir, { recursive: true });

    // Write content to disk
    const content = typeof upload.content === 'string'
      ? Buffer.from(upload.content, 'utf-8')
      : upload.content;

    fs.writeFileSync(filePath, content);

    // Record in DB (store sanitized name)
    const result = await this.pool.query(
      `INSERT INTO artifacts (id, run_id, task_id, name, mime_type, size_bytes, storage_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [id, upload.runId, upload.taskId, safeName, upload.mimeType, content.length, filePath]
    );

    // Emit audit event
    await this.pool.query(
      `INSERT INTO audit_events (run_id, task_id, correlation_id, event_type, payload)
       SELECT $1, $2, r.correlation_id, 'ARTIFACT_STORED', $3
       FROM runs r WHERE r.id = $1`,
      [upload.runId, upload.taskId, JSON.stringify({
        artifactId: id, name: upload.name, mimeType: upload.mimeType, sizeBytes: content.length
      })]
    );

    return result.rows[0];
  }

  // Retrieve artifact content
  async retrieve(artifactId: string): Promise<{ metadata: ArtifactMetadata; content: Buffer } | null> {
    const result = await this.pool.query(
      'SELECT * FROM artifacts WHERE id = $1',
      [artifactId]
    );

    if (result.rows.length === 0) return null;

    const metadata = result.rows[0];
    try {
      const content = fs.readFileSync(metadata.storage_path);
      return { metadata, content };
    } catch (err) {
      throw new Error(`Failed to read artifact file: ${(err as Error).message}`);
    }
  }

  // List artifacts for a run
  async listByRun(runId: string): Promise<ArtifactMetadata[]> {
    const result = await this.pool.query(
      'SELECT * FROM artifacts WHERE run_id = $1 ORDER BY created_at ASC',
      [runId]
    );
    return result.rows;
  }

  // List artifacts for a task
  async listByTask(runId: string, taskId: string): Promise<ArtifactMetadata[]> {
    const result = await this.pool.query(
      'SELECT * FROM artifacts WHERE run_id = $1 AND task_id = $2 ORDER BY created_at ASC',
      [runId, taskId]
    );
    return result.rows;
  }

  // Delete all artifacts for a run (cleanup)
  async deleteByRun(runId: string): Promise<number> {
    const artifacts = await this.pool.query(
      'SELECT storage_path FROM artifacts WHERE run_id = $1',
      [runId]
    );

    // Remove files from disk
    for (const row of artifacts.rows) {
      try {
        fs.unlinkSync(row.storage_path);
      } catch { /* file may already be gone */ }
    }

    // Remove directory
    const runDir = path.join(this.storagePath, runId);
    try {
      fs.rmSync(runDir, { recursive: true, force: true });
    } catch { /* directory may not exist */ }

    // Remove DB records
    const result = await this.pool.query(
      'DELETE FROM artifacts WHERE run_id = $1',
      [runId]
    );
    return result.rowCount || 0;
  }

  // Get total storage used by a run
  async getRunStorageUsage(runId: string): Promise<{ totalBytes: number; artifactCount: number }> {
    const result = await this.pool.query(
      `SELECT COUNT(*) as count, COALESCE(SUM(size_bytes), 0) as total_bytes
       FROM artifacts WHERE run_id = $1`,
      [runId]
    );
    return {
      totalBytes: parseInt(result.rows[0].total_bytes, 10),
      artifactCount: parseInt(result.rows[0].count, 10),
    };
  }
}

export function createArtifactStore(pool: Pool, storagePath?: string): ArtifactStore {
  return new ArtifactStore(pool, storagePath);
}
