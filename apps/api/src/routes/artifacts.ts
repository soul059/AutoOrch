import { Router, Request, Response } from 'express';
import { artifactStore } from '../services.js';

const router = Router();

// UUID validation helper - accepts both v4 and other common UUID formats
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUUID(str: string): boolean {
  return UUID_REGEX.test(str);
}

// List artifacts for a run
router.get('/run/:runId', async (req: Request, res: Response) => {
  try {
    const runId = req.params.runId as string;
    if (!isValidUUID(runId)) {
      res.status(400).json({ error: 'Invalid runId format - must be a valid UUID' });
      return;
    }
    const artifacts = await artifactStore.listByRun(runId);
    res.json(artifacts);
  } catch (err) {
    console.error('[artifacts.listByRun]', err);
    res.status(500).json({ error: 'Failed to list artifacts' });
  }
});

// List artifacts for a specific task
router.get('/run/:runId/task/:taskId', async (req: Request, res: Response) => {
  try {
    const runId = req.params.runId as string;
    const taskId = req.params.taskId as string;
    if (!isValidUUID(runId)) {
      res.status(400).json({ error: 'Invalid runId format - must be a valid UUID' });
      return;
    }
    if (!isValidUUID(taskId)) {
      res.status(400).json({ error: 'Invalid taskId format - must be a valid UUID' });
      return;
    }
    const artifacts = await artifactStore.listByTask(runId, taskId);
    res.json(artifacts);
  } catch (err) {
    console.error('[artifacts.listByTask]', err);
    res.status(500).json({ error: 'Failed to list artifacts' });
  }
});

// Upload/store an artifact
router.post('/', async (req: Request, res: Response) => {
  try {
    const { runId, taskId, name, mimeType, content } = req.body;

    if (!runId || !taskId || !name || !content) {
      res.status(400).json({ error: 'runId, taskId, name, and content are required' });
      return;
    }

    if (!isValidUUID(runId)) {
      res.status(400).json({ error: 'Invalid runId format - must be a valid UUID' });
      return;
    }
    if (!isValidUUID(taskId)) {
      res.status(400).json({ error: 'Invalid taskId format - must be a valid UUID' });
      return;
    }

    const artifact = await artifactStore.store({
      runId,
      taskId,
      name,
      mimeType: mimeType || 'application/octet-stream',
      content,
    });

    res.status(201).json(artifact);
  } catch (err) {
    console.error('[artifacts.store]', err);
    res.status(500).json({ error: 'Failed to store artifact' });
  }
});

// Get artifact metadata
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isValidUUID(id)) {
      res.status(400).json({ error: 'Invalid artifact id format - must be a valid UUID' });
      return;
    }
    const result = await artifactStore.retrieve(id);
    if (!result) {
      res.status(404).json({ error: 'Artifact not found' });
      return;
    }
    res.json({
      metadata: result.metadata,
      contentLength: result.content.length,
    });
  } catch (err) {
    console.error('[artifacts.get]', err);
    res.status(500).json({ error: 'Failed to retrieve artifact' });
  }
});

// Download artifact content
router.get('/:id/download', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isValidUUID(id)) {
      res.status(400).json({ error: 'Invalid artifact id format - must be a valid UUID' });
      return;
    }
    const result = await artifactStore.retrieve(id);
    if (!result) {
      res.status(404).json({ error: 'Artifact not found' });
      return;
    }
    res.setHeader('Content-Type', result.metadata.mimeType || 'application/octet-stream');
    // Use RFC 6266 encoding to prevent header injection attacks
    const safeName = encodeURIComponent(result.metadata.name).replace(/['()]/g, escape);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeName}`);
    res.send(result.content);
  } catch (err) {
    console.error('[artifacts.download]', err);
    res.status(500).json({ error: 'Failed to download artifact' });
  }
});

// Get storage usage for a run
router.get('/run/:runId/usage', async (req: Request, res: Response) => {
  try {
    const runId = req.params.runId as string;
    if (!isValidUUID(runId)) {
      res.status(400).json({ error: 'Invalid runId format - must be a valid UUID' });
      return;
    }
    const usage = await artifactStore.getRunStorageUsage(runId);
    res.json(usage);
  } catch (err) {
    console.error('[artifacts.usage]', err);
    res.status(500).json({ error: 'Failed to get storage usage' });
  }
});

// Delete all artifacts for a run
router.delete('/run/:runId', async (req: Request, res: Response) => {
  try {
    const runId = req.params.runId as string;
    if (!isValidUUID(runId)) {
      res.status(400).json({ error: 'Invalid runId format - must be a valid UUID' });
      return;
    }
    const count = await artifactStore.deleteByRun(runId);
    res.json({ deleted: count });
  } catch (err) {
    console.error('[artifacts.deleteByRun]', err);
    res.status(500).json({ error: 'Failed to delete artifacts' });
  }
});

export default router;
