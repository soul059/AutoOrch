// Audit Pagination Tests
// Tests for cursor-based pagination and page size limits

import { describe, it, expect } from 'vitest';

// ============================================================================
// AUDIT PAGINATION
// ============================================================================

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;

interface AuditEvent {
  id: string;
  runId: string;
  eventType: string;
  severity: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  message: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

interface PaginationParams {
  limit?: number;
  cursor?: string;
}

interface PaginatedResult<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
  pageSize: number;
}

// Simulates pagination logic
function paginateAuditEvents(
  allEvents: AuditEvent[],
  params: PaginationParams
): PaginatedResult<AuditEvent> {
  // Enforce page size limits
  let limit = params.limit ?? DEFAULT_PAGE_SIZE;
  if (limit > MAX_PAGE_SIZE) {
    limit = MAX_PAGE_SIZE;
  }
  if (limit < 1) {
    limit = 1;
  }

  // Sort by createdAt DESC, then by id DESC for stable ordering
  const sorted = [...allEvents].sort((a, b) => {
    const dateCompare = b.createdAt.getTime() - a.createdAt.getTime();
    if (dateCompare !== 0) return dateCompare;
    return b.id.localeCompare(a.id);
  });

  // Apply cursor
  let startIndex = 0;
  if (params.cursor) {
    const cursorIndex = sorted.findIndex(e => e.id === params.cursor);
    if (cursorIndex !== -1) {
      startIndex = cursorIndex + 1;
    }
  }

  // Slice results
  const pageData = sorted.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < sorted.length;
  const nextCursor = hasMore ? pageData[pageData.length - 1]?.id ?? null : null;

  return {
    data: pageData,
    nextCursor,
    hasMore,
    pageSize: limit,
  };
}

// Generate test audit events
function generateEvents(count: number, runId: string = 'run_1'): AuditEvent[] {
  const events: AuditEvent[] = [];
  for (let i = 0; i < count; i++) {
    events.push({
      id: `evt_${String(i).padStart(5, '0')}`,
      runId,
      eventType: 'STATE_CHANGE',
      severity: 'INFO',
      message: `Event ${i}`,
      metadata: {},
      createdAt: new Date(Date.now() - i * 1000), // Newer events first
    });
  }
  return events;
}

describe('Audit Pagination', () => {
  describe('Page Size Limits', () => {
    it('uses default page size when not specified', () => {
      const events = generateEvents(100);
      const result = paginateAuditEvents(events, {});

      expect(result.pageSize).toBe(DEFAULT_PAGE_SIZE);
      expect(result.data.length).toBe(DEFAULT_PAGE_SIZE);
    });

    it('respects requested page size within limits', () => {
      const events = generateEvents(100);
      const result = paginateAuditEvents(events, { limit: 25 });

      expect(result.pageSize).toBe(25);
      expect(result.data.length).toBe(25);
    });

    it('caps page size at MAX_PAGE_SIZE', () => {
      const events = generateEvents(500);
      const result = paginateAuditEvents(events, { limit: 1000 });

      expect(result.pageSize).toBe(MAX_PAGE_SIZE);
      expect(result.data.length).toBe(MAX_PAGE_SIZE);
    });

    it('enforces minimum page size of 1', () => {
      const events = generateEvents(10);
      const result = paginateAuditEvents(events, { limit: 0 });

      expect(result.pageSize).toBe(1);
    });

    it('handles negative page size', () => {
      const events = generateEvents(10);
      const result = paginateAuditEvents(events, { limit: -5 });

      expect(result.pageSize).toBe(1);
    });

    it('MAX_PAGE_SIZE is 100', () => {
      expect(MAX_PAGE_SIZE).toBe(100);
    });
  });

  describe('Cursor-Based Pagination', () => {
    it('returns first page when no cursor provided', () => {
      const events = generateEvents(30);
      const result = paginateAuditEvents(events, { limit: 10 });

      expect(result.data.length).toBe(10);
      expect(result.data[0].id).toBe('evt_00000');
      expect(result.data[9].id).toBe('evt_00009');
    });

    it('returns next page using cursor', () => {
      const events = generateEvents(30);
      
      // First page
      const page1 = paginateAuditEvents(events, { limit: 10 });
      expect(page1.nextCursor).toBe('evt_00009');

      // Second page
      const page2 = paginateAuditEvents(events, { limit: 10, cursor: page1.nextCursor! });
      expect(page2.data[0].id).toBe('evt_00010');
      expect(page2.data[9].id).toBe('evt_00019');
    });

    it('returns remaining items on last page', () => {
      const events = generateEvents(25);
      
      // First page (10 items)
      const page1 = paginateAuditEvents(events, { limit: 10 });
      
      // Second page (10 items)
      const page2 = paginateAuditEvents(events, { limit: 10, cursor: page1.nextCursor! });
      
      // Third page (5 items)
      const page3 = paginateAuditEvents(events, { limit: 10, cursor: page2.nextCursor! });
      expect(page3.data.length).toBe(5);
      expect(page3.hasMore).toBe(false);
      expect(page3.nextCursor).toBe(null);
    });

    it('handles invalid cursor gracefully (returns from start)', () => {
      const events = generateEvents(30);
      const result = paginateAuditEvents(events, { limit: 10, cursor: 'invalid_cursor' });

      expect(result.data.length).toBe(10);
      expect(result.data[0].id).toBe('evt_00000');
    });

    it('sets hasMore correctly', () => {
      const events = generateEvents(15);
      
      // First page - has more
      const page1 = paginateAuditEvents(events, { limit: 10 });
      expect(page1.hasMore).toBe(true);
      expect(page1.nextCursor).not.toBe(null);

      // Second page - no more
      const page2 = paginateAuditEvents(events, { limit: 10, cursor: page1.nextCursor! });
      expect(page2.hasMore).toBe(false);
      expect(page2.nextCursor).toBe(null);
    });
  });

  describe('Ordering', () => {
    it('returns events in reverse chronological order', () => {
      const events = generateEvents(10);
      const result = paginateAuditEvents(events, { limit: 10 });

      // First event should be most recent
      expect(result.data[0].createdAt.getTime()).toBeGreaterThan(
        result.data[9].createdAt.getTime()
      );
    });

    it('uses ID as secondary sort for same timestamp', () => {
      const sameTime = new Date();
      const events: AuditEvent[] = [
        { id: 'evt_a', runId: 'r1', eventType: 'X', severity: 'INFO', message: '', metadata: {}, createdAt: sameTime },
        { id: 'evt_c', runId: 'r1', eventType: 'X', severity: 'INFO', message: '', metadata: {}, createdAt: sameTime },
        { id: 'evt_b', runId: 'r1', eventType: 'X', severity: 'INFO', message: '', metadata: {}, createdAt: sameTime },
      ];

      const result = paginateAuditEvents(events, { limit: 10 });

      // Should be sorted by ID descending
      expect(result.data[0].id).toBe('evt_c');
      expect(result.data[1].id).toBe('evt_b');
      expect(result.data[2].id).toBe('evt_a');
    });
  });

  describe('Empty Results', () => {
    it('handles empty event list', () => {
      const result = paginateAuditEvents([], { limit: 10 });

      expect(result.data).toEqual([]);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBe(null);
    });

    it('handles cursor past end of list', () => {
      const events = generateEvents(10);
      const result = paginateAuditEvents(events, { limit: 10, cursor: 'evt_00009' });

      expect(result.data).toEqual([]);
      expect(result.hasMore).toBe(false);
    });
  });

  describe('Full Iteration', () => {
    it('iterates through all events with pagination', () => {
      const events = generateEvents(97); // Odd number to test partial last page
      const collectedIds: string[] = [];
      
      let cursor: string | null = null;
      let iterations = 0;
      const maxIterations = 20; // Safety limit

      do {
        const result = paginateAuditEvents(events, { limit: 10, cursor: cursor ?? undefined });
        collectedIds.push(...result.data.map(e => e.id));
        cursor = result.nextCursor;
        iterations++;
      } while (cursor && iterations < maxIterations);

      expect(collectedIds.length).toBe(97);
      expect(iterations).toBe(10); // ceil(97/10) = 10 pages
    });
  });
});

// ============================================================================
// RUN-SCOPED FILTERING
// ============================================================================

function paginateAuditEventsForRun(
  allEvents: AuditEvent[],
  runId: string,
  params: PaginationParams
): PaginatedResult<AuditEvent> {
  const filtered = allEvents.filter(e => e.runId === runId);
  return paginateAuditEvents(filtered, params);
}

describe('Run-Scoped Audit Pagination', () => {
  it('only returns events for specified run', () => {
    const events = [
      ...generateEvents(10, 'run_1'),
      ...generateEvents(10, 'run_2'),
      ...generateEvents(10, 'run_3'),
    ];

    const result = paginateAuditEventsForRun(events, 'run_2', { limit: 50 });

    expect(result.data.length).toBe(10);
    expect(result.data.every(e => e.runId === 'run_2')).toBe(true);
  });

  it('paginates within filtered results', () => {
    const events = [
      ...generateEvents(50, 'run_1'),
      ...generateEvents(50, 'run_2'),
    ];

    const result = paginateAuditEventsForRun(events, 'run_1', { limit: 10 });

    expect(result.data.length).toBe(10);
    expect(result.hasMore).toBe(true);
  });
});
