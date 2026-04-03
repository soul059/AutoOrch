import { Router, Request, Response } from 'express';
import pool from '../config/database.js';

const router = Router();

// Maximum results per page to prevent DoS
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;

// List audit events for a run with cursor-based pagination
router.get('/run/:runId', async (req: Request, res: Response) => {
  try {
    const { eventType, limit, cursor } = req.query;
    const pageSize = Math.min(parseInt(limit as string, 10) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    
    let query = 'SELECT * FROM audit_events WHERE run_id = $1';
    const params: unknown[] = [req.params.runId];
    let paramIdx = 2;

    if (eventType) {
      query += ` AND event_type = $${paramIdx}`;
      params.push(eventType);
      paramIdx++;
    }

    // Cursor-based pagination (cursor is the timestamp of last seen event)
    if (cursor) {
      query += ` AND timestamp < $${paramIdx}`;
      params.push(new Date(cursor as string));
      paramIdx++;
    }

    query += ' ORDER BY timestamp DESC';
    query += ` LIMIT $${paramIdx}`;
    params.push(pageSize + 1); // Fetch one extra to determine if there's more

    const result = await pool.query(query, params);
    
    const hasMore = result.rows.length > pageSize;
    const events = hasMore ? result.rows.slice(0, pageSize) : result.rows;
    const nextCursor = hasMore && events.length > 0 
      ? events[events.length - 1].timestamp.toISOString() 
      : null;

    res.json({
      events,
      pagination: {
        pageSize,
        hasMore,
        nextCursor,
      },
    });
  } catch (err) {
    console.error('[audit.list]', err);
    res.status(500).json({ error: 'Failed to list audit events' });
  }
});

// List checkpoints for a run
router.get('/checkpoints/:runId', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT * FROM checkpoints WHERE run_id = $1 ORDER BY sequence_number DESC',
      [req.params.runId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[audit.checkpoints]', err);
    res.status(500).json({ error: 'Failed to list checkpoints' });
  }
});

export default router;
