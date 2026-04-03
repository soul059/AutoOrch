import { Router, Request, Response } from 'express';
import { deadLetterHandler } from '../services.js';

const router = Router();

// List dead-letter entries
router.get('/', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const entries = await deadLetterHandler.list(limit);
    res.json(entries);
  } catch (err) {
    console.error('[deadletter.list]', err);
    res.status(500).json({ error: 'Failed to list dead-letter entries' });
  }
});

// List dead-letter entries for a run
router.get('/run/:runId', async (req: Request, res: Response) => {
  try {
    const entries = await deadLetterHandler.listByRun(req.params.runId as string);
    res.json(entries);
  } catch (err) {
    console.error('[deadletter.listByRun]', err);
    res.status(500).json({ error: 'Failed to list dead-letter entries' });
  }
});

// Get dead-letter queue count
router.get('/count', async (_req: Request, res: Response) => {
  try {
    const count = await deadLetterHandler.count();
    res.json({ pending: count });
  } catch (err) {
    console.error('[deadletter.count]', err);
    res.status(500).json({ error: 'Failed to count dead-letter entries' });
  }
});

// Retry a dead-letter entry (re-queue the failed task)
router.post('/:id/retry', async (req: Request, res: Response) => {
  try {
    const result = await deadLetterHandler.retry(req.params.id as string);
    if (!result.success) {
      res.status(400).json({ error: result.reason });
      return;
    }
    res.json({ status: 'retried' });
  } catch (err) {
    console.error('[deadletter.retry]', err);
    res.status(500).json({ error: 'Failed to retry dead-letter entry' });
  }
});

// Enqueue a failed task to dead-letter
router.post('/enqueue/:taskId', async (req: Request, res: Response) => {
  try {
    const id = await deadLetterHandler.enqueue(req.params.taskId as string);
    res.status(201).json({ id, status: 'enqueued' });
  } catch (err) {
    console.error('[deadletter.enqueue]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// Purge old entries
router.delete('/purge', async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string, 10) || 30;
    const purged = await deadLetterHandler.purge(days);
    res.json({ purged });
  } catch (err) {
    console.error('[deadletter.purge]', err);
    res.status(500).json({ error: 'Failed to purge dead-letter entries' });
  }
});

// Delete/discard a single dead-letter entry
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const result = await deadLetterHandler.discard(req.params.id as string);
    if (!result) {
      res.status(404).json({ error: 'Dead-letter entry not found' });
      return;
    }
    res.json({ status: 'discarded' });
  } catch (err) {
    console.error('[deadletter.discard]', err);
    res.status(500).json({ error: 'Failed to discard dead-letter entry' });
  }
});

export default router;
