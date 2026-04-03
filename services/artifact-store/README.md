# Artifact Store Service

The Artifact Store manages persistent storage of run artifacts including outputs, logs, and files generated during workflow execution.

## Overview

The Artifact Store provides a dual-layer storage approach:
- **PostgreSQL** for metadata (artifact records, references)
- **Filesystem** for actual blob content (files, outputs)

## Features

- **Secure Storage**: Path traversal protection with filename sanitization
- **Audit Trail**: All artifact operations logged to `audit_events` table
- **Storage Tracking**: Monitor disk usage per run
- **Organized Structure**: Artifacts stored in `/{runId}/{taskId}/` hierarchy

## API

### `store(upload: ArtifactUpload): Promise<ArtifactMetadata>`

Store a new artifact with metadata.

```typescript
const artifact = await artifactStore.store({
  runId: 'run-123',
  taskId: 'task-456',
  name: 'output.json',
  mimeType: 'application/json',
  content: Buffer.from(JSON.stringify(data))
});
```

### `retrieve(artifactId: string): Promise<{ metadata, content } | null>`

Fetch an artifact by ID, returning both metadata and file content.

```typescript
const result = await artifactStore.retrieve('artifact-789');
if (result) {
  console.log(result.metadata.name);
  console.log(result.content.toString());
}
```

### `listByRun(runId: string): Promise<ArtifactMetadata[]>`

List all artifacts for a specific run.

### `listByTask(runId: string, taskId: string): Promise<ArtifactMetadata[]>`

List artifacts for a specific task within a run.

### `deleteByRun(runId: string): Promise<number>`

Delete all artifacts for a run (cleanup). Returns count of deleted artifacts.

### `getRunStorageUsage(runId: string): Promise<{ totalBytes, artifactCount }>`

Get storage statistics for a run.

## Security

### Path Traversal Protection

All filenames are sanitized before storage:
- Path separators (`/`, `\`) replaced with `_`
- Traversal sequences (`..`) removed
- Leading dots removed
- Invalid characters stripped
- Maximum filename length enforced (255 chars)

The resolved path is validated to ensure it stays within the configured storage directory.

### Audit Events

Every `store` operation emits an `ARTIFACT_STORED` audit event with:
- Artifact ID
- Original filename
- MIME type
- File size

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `ARTIFACT_STORAGE_PATH` | `./artifacts` | Base directory for file storage |
| `MAX_ARTIFACT_SIZE` | `104857600` (100MB) | Maximum artifact file size |

## Database Schema

```sql
CREATE TABLE artifacts (
  id VARCHAR(50) PRIMARY KEY,
  run_id VARCHAR(50) NOT NULL REFERENCES runs(id),
  task_id VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100),
  size_bytes INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_artifacts_run_id ON artifacts(run_id);
CREATE INDEX idx_artifacts_task_id ON artifacts(task_id);
```

## Usage Example

```typescript
import { createArtifactStore } from '@autoorch/artifact-store';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const artifactStore = createArtifactStore(pool, './artifacts');

// Store an artifact
const artifact = await artifactStore.store({
  runId: 'run-001',
  taskId: 'task-001',
  name: 'result.txt',
  mimeType: 'text/plain',
  content: 'Task completed successfully!'
});

// Check storage usage
const usage = await artifactStore.getRunStorageUsage('run-001');
console.log(`Run uses ${usage.totalBytes} bytes across ${usage.artifactCount} artifacts`);

// Cleanup when run is deleted
await artifactStore.deleteByRun('run-001');
```

## Integration

The Artifact Store is integrated with:
- **Worker Runtime**: Stores tool execution outputs
- **API Routes**: Exposes `/api/artifacts` endpoints
- **Dashboard**: Artifact viewer component

## File Structure

```
artifacts/
├── {runId}/
│   ├── {taskId}/
│   │   ├── {artifactId}_{sanitizedName}
│   │   └── ...
│   └── ...
└── ...
```
