import pool from './config/database.js';
import { createStateMachine, createTaskBroker, createCheckpointManager, createDeadLetterHandler } from '@autoorch/orchestrator';
import { createPolicyEngine } from '@autoorch/policy-engine';
import { createWorkerRuntime } from '@autoorch/worker-runtime';
import { ProviderRouter } from '@autoorch/provider-registry';
import { createArtifactStore } from '@autoorch/artifact-store';
import { resolveGatewayCredential } from './routes/gateway.js';
import { broadcast } from './events.js';

// Extract actual output from thinking models (Qwen, DeepSeek, etc.)
// These models output: <think>...thinking...</think>\n\nActual output
function extractActualOutput(content: string): { thinking: string | null; output: string } {
  if (!content) return { thinking: null, output: '' };
  
  // Pattern 1: <think>...</think> tags (Qwen, DeepSeek)
  const thinkTagMatch = content.match(/^<think>([\s\S]*?)<\/think>\s*([\s\S]*)$/i);
  if (thinkTagMatch) {
    console.log(`[extractActualOutput] Found <think> tags, thinking length: ${thinkTagMatch[1].length}, output length: ${thinkTagMatch[2].length}`);
    return { thinking: thinkTagMatch[1].trim(), output: thinkTagMatch[2].trim() };
  }
  
  // Pattern 2: "Thinking Process:" or "Thinking:" header followed by actual output
  const thinkingHeaderMatch = content.match(/^(?:Thinking Process:|Thinking:|## Thinking|### Thinking)[\s\S]*?\n\n((?:```[\s\S]*?```|[^])+)$/im);
  if (thinkingHeaderMatch) {
    // Find where actual output starts (usually after double newline and before code/tool calls/JSON)
    const parts = content.split(/\n\n(?=```|file_write|\{|## Output|### Output|## Code|### Code|Here is|The code|I will)/i);
    if (parts.length > 1) {
      const thinking = parts[0];
      const output = parts.slice(1).join('\n\n');
      console.log(`[extractActualOutput] Found thinking header, thinking length: ${thinking.length}, output length: ${output.length}`);
      return { thinking: thinking.trim(), output: output.trim() };
    }
  }
  
  // Pattern 3: Look for common output markers that indicate end of thinking
  const outputMarkers = [
    /\n\n(\{[\s\S]+?\})\s*$/,  // JSON object (for task plans, structured output)
    /\n\n(```\w+\n[\s\S]+?```)/,  // Code block
    /\n\n(file_write\s*\([\s\S]+?\))/,  // Tool call
    /\n\n(Here is the (?:code|solution|implementation|plan|task)[\s\S]+)/i,  // "Here is the..."
    /\n\n(The (?:code|solution|implementation|plan|task) (?:is|follows)[\s\S]+)/i,  // "The ... is..."
  ];
  
  for (const marker of outputMarkers) {
    const match = content.match(marker);
    if (match && match.index !== undefined) {
      const thinking = content.slice(0, match.index).trim();
      const output = content.slice(match.index).trim();
      if (output.length > 50) {  // Ensure we have substantial output
        console.log(`[extractActualOutput] Found output marker, thinking length: ${thinking.length}, output length: ${output.length}`);
        return { thinking, output };
      }
    }
  }
  
  // No thinking pattern detected, return full content as output
  return { thinking: null, output: content };
}

// Parse text-based tool calls from LLM output (for models without native tool calling)
function parseTextBasedToolCalls(content: string): Array<{ name: string; arguments: Record<string, unknown> }> {
  const toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  let match: RegExpExecArray | null;
  
  // Pattern 1a: file_write("path", "content") with double quotes (handles nested single quotes)
  const fileWriteDQRegex = /file_write\s*\(\s*"([^"]+)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\)/g;
  while ((match = fileWriteDQRegex.exec(content)) !== null) {
    const unescapedContent = match[2]
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
    toolCalls.push({
      name: 'file_write',
      arguments: { path: match[1], content: unescapedContent }
    });
  }
  
  // Pattern 1b: file_write('path', 'content') with single quotes (handles nested double quotes)
  const fileWriteSQRegex = /file_write\s*\(\s*'([^']+)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*\)/g;
  while ((match = fileWriteSQRegex.exec(content)) !== null) {
    if (!toolCalls.some(tc => tc.arguments.path === match![1])) {
      const unescapedContent = match[2]
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\'/g, "'")
        .replace(/\\\\/g, '\\');
      toolCalls.push({
        name: 'file_write',
        arguments: { path: match[1], content: unescapedContent }
      });
    }
  }
  
  // Pattern 1b: file_write(path="...", content="...") with double quotes
  const fileWriteKwargsDQRegex = /file_write\s*\(\s*(?:file_)?path\s*=\s*"([^"]+)"\s*,\s*content\s*=\s*"((?:[^"\\]|\\.)*)"\s*\)/g;
  while ((match = fileWriteKwargsDQRegex.exec(content)) !== null) {
    // Avoid duplicates
    if (!toolCalls.some(tc => tc.arguments.path === match![1])) {
      // Unescape the content (handle \\n -> \n, \\" -> ", etc.)
      const unescapedContent = match[2]
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
      toolCalls.push({
        name: 'file_write',
        arguments: { path: match[1], content: unescapedContent }
      });
    }
  }
  
  // Pattern 1c: file_write(path='...', content='...') with single quotes  
  const fileWriteKwargsSQRegex = /file_write\s*\(\s*(?:file_)?path\s*=\s*'([^']+)'\s*,\s*content\s*=\s*'((?:[^'\\]|\\.)*)'\s*\)/g;
  while ((match = fileWriteKwargsSQRegex.exec(content)) !== null) {
    // Avoid duplicates
    if (!toolCalls.some(tc => tc.arguments.path === match![1])) {
      const unescapedContent = match[2]
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\'/g, "'")
        .replace(/\\\\/g, '\\');
      toolCalls.push({
        name: 'file_write',
        arguments: { path: match[1], content: unescapedContent }
      });
    }
  }
  
  // Pattern 2: JSON-like tool calls {"tool": "file_write", "path": "...", "content": "..."}
  const jsonToolRegex = /\{\s*"tool"\s*:\s*"file_write"\s*,\s*"path"\s*:\s*"([^"]+)"\s*,\s*"content"\s*:\s*"([\s\S]*?)"\s*\}/g;
  while ((match = jsonToolRegex.exec(content)) !== null) {
    toolCalls.push({
      name: 'file_write',
      arguments: { path: match[1], content: match[2].replace(/\\n/g, '\n').replace(/\\"/g, '"') }
    });
  }
  
  // Pattern 3: Code block with file content - ```python\n# filename: hello.py\ncode```
  // Only use this if no explicit tool calls were found
  if (toolCalls.length === 0) {
    const codeBlockRegex = /```(\w+)?\s*\n([\s\S]*?)```/g;
    while ((match = codeBlockRegex.exec(content)) !== null) {
      const language = match[1] || 'txt';
      const codeContent = match[2].trim();
      
      // Check for filename comment at start of code
      let filename: string | undefined;
      const filenameMatch = codeContent.match(/^(?:#|\/\/)\s*filename:\s*(\S+)/i);
      if (filenameMatch) {
        filename = filenameMatch[1];
      }
      
      // Try to infer filename from language if not specified
      if (!filename && codeContent && codeContent.length > 10) {
        const extMap: Record<string, string> = {
          python: '.py', javascript: '.js', typescript: '.ts', java: '.java',
          cpp: '.cpp', c: '.c', rust: '.rs', go: '.go', ruby: '.rb', php: '.php',
          html: '.html', css: '.css', json: '.json', yaml: '.yaml', yml: '.yml',
          sh: '.sh', bash: '.sh', sql: '.sql', md: '.md', markdown: '.md'
        };
        const ext = extMap[language.toLowerCase()] || `.${language}`;
        filename = `output${ext}`;
      }
      
      // Clean code content (remove filename comment if present)
      let cleanCode = codeContent;
      if (filenameMatch) {
        cleanCode = codeContent.replace(/^(?:#|\/\/)\s*filename:\s*\S+\s*\n?/i, '').trim();
      }
      
      if (filename && cleanCode) {
        // Skip JSON blocks that look like task plans (not actual code output)
        if (language.toLowerCase() === 'json') {
          try {
            const parsed = JSON.parse(cleanCode);
            // If it looks like a task plan, skip it
            if (parsed.task_id !== undefined || parsed.task_name !== undefined || 
                parsed.dependencies !== undefined || parsed.output_format !== undefined) {
              console.log(`[parseTextBasedToolCalls] Skipping JSON task plan (not actual output)`);
              continue;
            }
          } catch { /* not valid JSON, proceed */ }
        }
        
        // Avoid duplicate entries
        if (!toolCalls.some(tc => tc.arguments.path === filename)) {
          console.log(`[parseTextBasedToolCalls] Found code block: lang=${language}, filename=${filename}, code length=${cleanCode.length}`);
          toolCalls.push({
            name: 'file_write',
            arguments: { path: filename, content: cleanCode }
          });
        }
      }
    }
  }
  
  return toolCalls;
}

// Singleton service instances — initialized once at startup
const stateMachine = createStateMachine(pool);
const taskBroker = createTaskBroker(pool, stateMachine);
const checkpointManager = createCheckpointManager(pool);
const deadLetterHandler = createDeadLetterHandler(pool);
const policyEngine = createPolicyEngine(pool);
const artifactStore = createArtifactStore(pool);
// Wire artifact store to worker runtime so files are properly stored
const workerRuntime = createWorkerRuntime(pool, artifactStore);
const providerRouter = new ProviderRouter(pool);

// Wire credential resolver so the router can look up gateway API keys
providerRouter.setCredentialResolver(resolveGatewayCredential);

// Track if services are already initialized (prevent duplicate intervals)
let servicesInitialized = false;

// Track interval IDs for cleanup
let planningIntervalId: NodeJS.Timeout | null = null;
let routingIntervalId: NodeJS.Timeout | null = null;
let executionIntervalId: NodeJS.Timeout | null = null;

// Track tasks currently being processed to prevent duplicate execution
const processingTasks = new Set<string>();

export async function initializeServices(): Promise<void> {
  // Prevent duplicate initialization (fixes Bug 8)
  if (servicesInitialized) {
    console.log('[Services] Already initialized, skipping...');
    return;
  }
  servicesInitialized = true;

  // Load provider adapters from DB
  await providerRouter.loadAdapters();
  console.log('[Services] Provider adapters loaded');

  // Recover orphaned tasks from previous crashes
  const recovered = await taskBroker.recoverOrphanedTasks();
  if (recovered > 0) {
    console.log(`[Services] Recovered ${recovered} orphaned tasks`);
  }

  // Run initial health checks
  await providerRouter.runHealthChecks();
  console.log('[Services] Provider health checks complete');

  // Expire overdue approvals
  const expired = await policyEngine.expireOverdueApprovals();
  if (expired > 0) {
    console.log(`[Services] Expired ${expired} overdue approvals`);
  }

  // Clear any existing intervals (for hot reload safety)
  if (planningIntervalId) clearInterval(planningIntervalId);
  if (routingIntervalId) clearInterval(routingIntervalId);
  if (executionIntervalId) clearInterval(executionIntervalId);
  processingTasks.clear();

  // Start background worker to process PLANNING state
  planningIntervalId = startPlanningWorker();
  console.log('[Services] PLANNING state worker started');
  
  // Start background worker to process ROUTING state  
  routingIntervalId = startRoutingWorker();
  console.log('[Services] ROUTING state worker started');
  
  // Start background worker to execute DISPATCHED tasks
  executionIntervalId = startExecutionWorker();
  console.log('[Services] EXECUTION worker started');
}

// Background worker to automatically process runs stuck in PLANNING state
function startPlanningWorker(): NodeJS.Timeout {
  const PLANNING_INTERVAL = 10000; // Check every 10 seconds
  const PLANNING_TIMEOUT = 5 * 60 * 1000; // 5 minutes

  return setInterval(async () => {
    try {
      // Find runs in PLANNING state
      const result = await pool.query(`
        SELECT id, prompt, created_at, updated_at, workflow_template_id, custom_agent_sequence
        FROM runs
        WHERE state = 'PLANNING'
        ORDER BY updated_at ASC
        LIMIT 5
      `);

      for (const run of result.rows) {
        const timeInPlanning = Date.now() - new Date(run.updated_at).getTime();

        // If stuck too long, fail the run
        if (timeInPlanning > PLANNING_TIMEOUT) {
          console.warn(`[PlanningWorker] Run ${run.id} stuck in PLANNING for ${Math.round(timeInPlanning/1000)}s, failing`);
          await stateMachine.transitionRunState(run.id, 'FAILED', 'Planning timed out after 5 minutes');
          broadcast(run.id, {
            type: 'RUN_STATE_CHANGED',
            timestamp: new Date().toISOString(),
            payload: { runId: run.id, newState: 'FAILED', reason: 'Planning timeout' }
          });
          continue;
        }

        // Auto-generate plan based on workflow template or custom sequence
        console.log(`[PlanningWorker] Processing run ${run.id} in PLANNING state`);

        try {
          let agentSequence: string[] = [];
          let dependencies: Record<string, string[]> = {};

          // Check for custom agent sequence first (per-run override)
          if (run.custom_agent_sequence) {
            // Parse JSONB - might be string or already parsed
            let rawSequence = run.custom_agent_sequence;
            if (typeof rawSequence === 'string') {
              try { rawSequence = JSON.parse(rawSequence); } catch { rawSequence = []; }
            }
            if (Array.isArray(rawSequence) && rawSequence.length > 0) {
              agentSequence = rawSequence;
              console.log(`[PlanningWorker] Using custom agent sequence: ${agentSequence.join(' → ')}`);
            }
          }
          // Then check for workflow template
          else if (run.workflow_template_id) {
            const templateResult = await pool.query(
              'SELECT agent_sequence, dependencies FROM workflow_templates WHERE id = $1',
              [run.workflow_template_id]
            );
            if (templateResult.rows.length > 0) {
              const template = templateResult.rows[0];
              // Parse JSONB - might be string or already parsed
              let rawSequence = template.agent_sequence;
              if (typeof rawSequence === 'string') {
                try { rawSequence = JSON.parse(rawSequence); } catch { rawSequence = []; }
              }
              agentSequence = Array.isArray(rawSequence) ? rawSequence : [];
              
              let rawDeps = template.dependencies;
              if (typeof rawDeps === 'string') {
                try { rawDeps = JSON.parse(rawDeps); } catch { rawDeps = {}; }
              }
              dependencies = rawDeps || {};
              
              console.log(`[PlanningWorker] Using workflow template: ${agentSequence.join(' → ')}`);
              console.log(`[PlanningWorker] Workflow dependencies: ${JSON.stringify(dependencies)}`);
            }
          }
          // Fallback: look for default workflow template
          else {
            const defaultTemplate = await pool.query(
              'SELECT agent_sequence, dependencies FROM workflow_templates WHERE is_default = true LIMIT 1'
            );
            if (defaultTemplate.rows.length > 0) {
              // Parse JSONB - might be string or already parsed
              let rawSequence = defaultTemplate.rows[0].agent_sequence;
              if (typeof rawSequence === 'string') {
                try { rawSequence = JSON.parse(rawSequence); } catch { rawSequence = []; }
              }
              agentSequence = Array.isArray(rawSequence) ? rawSequence : [];
              
              let rawDeps = defaultTemplate.rows[0].dependencies;
              if (typeof rawDeps === 'string') {
                try { rawDeps = JSON.parse(rawDeps); } catch { rawDeps = {}; }
              }
              dependencies = rawDeps || {};
              
              console.log(`[PlanningWorker] Using default workflow template: ${agentSequence.join(' → ')}`);
              console.log(`[PlanningWorker] Default workflow dependencies: ${JSON.stringify(dependencies)}`);
            }
          }

          // Bug 5 fix: Validate agent sequence is not empty
          if (agentSequence.length === 0) {
            console.error(`[PlanningWorker] Run ${run.id} has no agents defined. Create a workflow or select agents.`);
            await stateMachine.transitionRunState(run.id, 'FAILED', 'No agents defined in workflow. Please create a workflow template or specify agents.');
            broadcast(run.id, {
              type: 'RUN_STATE_CHANGED',
              timestamp: new Date().toISOString(),
              payload: { runId: run.id, newState: 'FAILED', reason: 'No agents defined' }
            });
            continue;
          }

          // Validate all agents exist in the database
          const agentCheck = await pool.query(
            `SELECT role_name FROM agent_role_definitions WHERE role_name = ANY($1)`,
            [agentSequence]
          );
          const existingAgents = new Set(agentCheck.rows.map((r: any) => r.role_name));
          const missingAgents = agentSequence.filter(a => !existingAgents.has(a));
          
          if (missingAgents.length > 0) {
            console.error(`[PlanningWorker] Run ${run.id} references undefined agents: ${missingAgents.join(', ')}`);
            await stateMachine.transitionRunState(run.id, 'FAILED', `Undefined agents: ${missingAgents.join(', ')}. Create them first.`);
            broadcast(run.id, {
              type: 'RUN_STATE_CHANGED',
              timestamp: new Date().toISOString(),
              payload: { runId: run.id, newState: 'FAILED', reason: `Missing agents: ${missingAgents.join(', ')}` }
            });
            continue;
          }

          // Create tasks from agent sequence with proper dependencies
          const tasks = agentSequence.map((role, index) => {
            // Determine dependencies for this task
            let taskDependsOn: number[] = [];

            if (dependencies[role] && Array.isArray(dependencies[role])) {
              // Use explicit dependencies from workflow template
              taskDependsOn = dependencies[role]
                .map(depRole => agentSequence.indexOf(depRole))
                .filter(idx => idx >= 0 && idx < index);
              console.log(`[PlanningWorker] Task ${index} (${role}): explicit deps from workflow = [${taskDependsOn.join(', ')}]`);
            } else if (index > 0) {
              // Default: sequential dependency on previous task
              taskDependsOn = [index - 1];
              console.log(`[PlanningWorker] Task ${index} (${role}): sequential dep on task ${index - 1} (${agentSequence[index - 1]})`);
            } else {
              console.log(`[PlanningWorker] Task ${index} (${role}): no dependencies (first task)`);
            }

            return {
              agentRole: role,
              input: {
                prompt: run.prompt,
                role: role,
                taskIndex: index,
                totalTasks: agentSequence.length,
                isFirstTask: index === 0,
                isLastTask: index === agentSequence.length - 1,
              },
              dependsOn: taskDependsOn,
              maxRetries: 2
            };
          });

          console.log(`[PlanningWorker] Created ${tasks.length} tasks for run ${run.id}`);

          // Create tasks in the database
          await taskBroker.createTasksFromPlan(run.id, tasks);

          // Transition to ROUTING state
          await stateMachine.transitionRunState(run.id, 'ROUTING');

          broadcast(run.id, {
            type: 'RUN_STATE_CHANGED',
            timestamp: new Date().toISOString(),
            payload: {
              runId: run.id,
              newState: 'ROUTING',
              tasksPlanned: tasks.length,
              agentSequence: agentSequence
            }
          });

          console.log(`[PlanningWorker] Run ${run.id} transitioned to ROUTING with ${tasks.length} tasks`);
        } catch (err: any) {
          console.error(`[PlanningWorker] Failed to process run ${run.id}:`, err.message);
          // Will retry next interval
        }
      }
    } catch (err: any) {
      console.error('[PlanningWorker] Error in planning worker:', err.message);
    }
  }, PLANNING_INTERVAL);
}

// Background worker to automatically dispatch runs from ROUTING to EXECUTING
function startRoutingWorker(): NodeJS.Timeout {
  const ROUTING_INTERVAL = 5000; // Check every 5 seconds
  const ROUTING_TIMEOUT = 60000; // 1 minute timeout for routing

  return setInterval(async () => {
    try {
      // Find runs in ROUTING state
      const result = await pool.query(`
        SELECT id, updated_at FROM runs
        WHERE state = 'ROUTING'
        ORDER BY updated_at ASC
        LIMIT 5
      `);

      for (const run of result.rows) {
        try {
          console.log(`[RoutingWorker] Processing run ${run.id}`);
          
          // Bug 1 fix: Check for routing timeout
          const timeInRouting = Date.now() - new Date(run.updated_at).getTime();
          if (timeInRouting > ROUTING_TIMEOUT) {
            console.error(`[RoutingWorker] Run ${run.id} stuck in ROUTING for ${Math.round(timeInRouting/1000)}s`);
            await stateMachine.transitionRunState(run.id, 'FAILED', 'Routing timed out - no providers available for agents');
            broadcast(run.id, {
              type: 'RUN_STATE_CHANGED',
              timestamp: new Date().toISOString(),
              payload: { runId: run.id, newState: 'FAILED', reason: 'Routing timeout' }
            });
            continue;
          }
          
          // Check if run has any tasks at all
          const taskCountResult = await pool.query(
            'SELECT COUNT(*) as count FROM tasks WHERE run_id = $1',
            [run.id]
          );
          const taskCount = parseInt(taskCountResult.rows[0].count, 10);
          
          if (taskCount === 0) {
            console.error(`[RoutingWorker] Run ${run.id} has no tasks - failing`);
            await stateMachine.transitionRunState(run.id, 'FAILED', 'No tasks created during planning');
            broadcast(run.id, {
              type: 'RUN_STATE_CHANGED',
              timestamp: new Date().toISOString(),
              payload: { runId: run.id, newState: 'FAILED', reason: 'No tasks' }
            });
            continue;
          }
          
          // First, queue any ready tasks (with dependencies met)
          const queued = await taskBroker.queueReadyTasks(run.id);
          console.log(`[RoutingWorker] Queued ${queued} ready tasks for run ${run.id}`);
          
          // Then dispatch queued tasks to workers
          const dispatched = await taskBroker.dispatchTasks(run.id);
          
          if (dispatched.length > 0) {
            // Transition to EXECUTING
            await stateMachine.transitionRunState(run.id, 'EXECUTING');
            broadcast(run.id, {
              type: 'RUN_STATE_CHANGED',
              timestamp: new Date().toISOString(),
              payload: { runId: run.id, newState: 'EXECUTING', tasksDispatched: dispatched.length }
            });
            console.log(`[RoutingWorker] Run ${run.id} transitioned to EXECUTING, dispatched ${dispatched.length} tasks`);
          } else if (queued > 0) {
            // Tasks were queued but not dispatched (concurrency limit hit)
            // Still transition to EXECUTING - the execution worker will pick them up
            await stateMachine.transitionRunState(run.id, 'EXECUTING');
            broadcast(run.id, {
              type: 'RUN_STATE_CHANGED',
              timestamp: new Date().toISOString(),
              payload: { runId: run.id, newState: 'EXECUTING', tasksQueued: queued }
            });
            console.log(`[RoutingWorker] Run ${run.id} transitioned to EXECUTING with ${queued} queued tasks`);
          } else {
            // No tasks ready yet - dependencies not met, will retry next interval
            console.log(`[RoutingWorker] Run ${run.id} waiting for tasks to become ready`);
          }
        } catch (err: any) {
          console.error(`[RoutingWorker] Failed to process run ${run.id}:`, err.message);
        }
      }
    } catch (err: any) {
      console.error('[RoutingWorker] Error in routing worker:', err.message);
    }
  }, ROUTING_INTERVAL);
}

// Background worker to execute DISPATCHED tasks
function startExecutionWorker(): NodeJS.Timeout {
  const EXECUTION_INTERVAL = 3000; // Check every 3 seconds

  return setInterval(async () => {
    try {
      // First, dispatch any QUEUED tasks for EXECUTING runs
      const executingRuns = await pool.query(`
        SELECT DISTINCT r.id FROM runs r
        JOIN tasks t ON t.run_id = r.id
        WHERE r.state = 'EXECUTING' AND t.state = 'QUEUED'
      `);
      for (const run of executingRuns.rows) {
        const dispatched = await taskBroker.dispatchTasks(run.id);
        if (dispatched.length > 0) {
          console.log(`[ExecutionWorker] Dispatched ${dispatched.length} queued tasks for run ${run.id}`);
          // Broadcast that tasks have been dispatched
          broadcast(run.id, {
            type: 'TASKS_DISPATCHED',
            timestamp: new Date().toISOString(),
            payload: { runId: run.id, taskIds: dispatched, count: dispatched.length }
          });
        }
      }

      // Atomically claim DISPATCHED tasks using FOR UPDATE SKIP LOCKED
      // This prevents multiple workers from processing the same task
      // Also verify all dependencies are SUCCEEDED before claiming
      const client = await pool.connect();
      let claimedTasks: any[] = [];
      try {
        await client.query('BEGIN');
        const result = await client.query(`
          SELECT t.*, 
                 COALESCE(t.agent_role_name, t.agent_role::text) as effective_role,
                 r.state as run_state 
          FROM tasks t 
          JOIN runs r ON t.run_id = r.id
          WHERE t.state = 'DISPATCHED' 
          AND r.state = 'EXECUTING'
          AND NOT EXISTS (
            SELECT 1 FROM tasks dep
            WHERE dep.id = ANY(t.depends_on)
            AND dep.state NOT IN ('SUCCEEDED', 'SKIPPED')
          )
          ORDER BY t.created_at ASC
          LIMIT 10
          FOR UPDATE OF t SKIP LOCKED
        `);
        
        // Transition claimed tasks to RUNNING immediately in the same transaction
        for (const task of result.rows) {
          // Skip if already being processed in-memory (extra safety)
          if (processingTasks.has(task.id)) {
            continue;
          }
          
          await client.query(
            `UPDATE tasks SET state = 'RUNNING', updated_at = NOW() WHERE id = $1`,
            [task.id]
          );
          processingTasks.add(task.id);
          claimedTasks.push(task);
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      for (const task of claimedTasks) {
        const agentRole = task.effective_role || task.agent_role_name || task.agent_role;
        try {
          // Bug 3 fix: Re-check run state before execution
          // The run might have transitioned to WAITING_APPROVAL, PAUSED, etc.
          const runStateCheck = await pool.query(
            'SELECT state FROM runs WHERE id = $1',
            [task.run_id]
          );
          const currentRunState = runStateCheck.rows[0]?.state;
          
          if (currentRunState !== 'EXECUTING') {
            console.log(`[ExecutionWorker] Run ${task.run_id} is no longer EXECUTING (state: ${currentRunState}), re-queuing task ${task.id}`);
            // Re-queue the task for later
            await pool.query(
              `UPDATE tasks SET state = 'QUEUED', updated_at = NOW() WHERE id = $1`,
              [task.id]
            );
            processingTasks.delete(task.id);
            continue;
          }
          
          console.log(`[ExecutionWorker] Executing task ${task.id} (role: ${agentRole})`);
          
          // Already transitioned to RUNNING in the transaction above
          
          // Broadcast task state change
          broadcast(task.run_id, {
            type: 'TASK_STATE_CHANGED',
            timestamp: new Date().toISOString(),
            payload: { taskId: task.id, newState: 'RUNNING', role: agentRole }
          });
          
          // Select provider for this agent role
          const selected = await providerRouter.selectProvider({
            agentRole: agentRole,
            runId: task.run_id,
          });

          if (!selected) {
            console.error(`[ExecutionWorker] No provider available for role ${agentRole}`);
            await taskBroker.failTask(task.id, 'PROVIDER_ERROR', `No provider configured for agent role ${agentRole}`);
            broadcast(task.run_id, {
              type: 'TASK_STATE_CHANGED',
              timestamp: new Date().toISOString(),
              payload: { taskId: task.id, newState: 'FAILED', error: 'No provider available' }
            });
            continue;
          }

          console.log(`[ExecutionWorker] Using provider ID: ${selected.providerId}`);

          // Get provider details for logging
          const providerInfo = await pool.query(
            'SELECT name, model_name FROM provider_definitions WHERE id = $1',
            [selected.providerId]
          );
          const providerName = providerInfo.rows[0]?.name || 'unknown';
          const modelName = providerInfo.rows[0]?.model_name || 'unknown';
          console.log(`[ExecutionWorker] Provider: ${providerName}, Model: ${modelName}`);

          // Get agent role definition for system prompt and tool whitelist
          // Support both old schema (role enum) and new schema (role_name text)
          const roleResult = await pool.query(
            `SELECT system_prompt, tool_whitelist, role_name, role 
             FROM agent_role_definitions 
             WHERE role_name = $1 OR role::text = $1`,
            [agentRole]
          );
          const roleDefinition = roleResult.rows[0];
          
          if (!roleDefinition) {
            throw new Error(`Agent role "${agentRole}" not found in database. Cannot execute task.`);
          }
          
          let systemPrompt = roleDefinition.system_prompt || 'You are a helpful AI assistant.';
          const toolWhitelist: string[] = roleDefinition.tool_whitelist || [];
          const hasToolAccess = toolWhitelist.length > 0;
          
          // Add tool instructions to system prompt for models without native tool calling
          if (hasToolAccess && toolWhitelist.length > 0) {
            const toolInstructions = `

## Available Tools
You have access to the following tools. To use a tool, write the function call in your response.

${toolWhitelist.includes('file_write') || toolWhitelist.includes('*') ? `- file_write(path, content): Write content to a file. Example:
  file_write("hello.c", "#include <stdio.h>\\nint main() { printf(\\"Hello World\\\\n\\"); return 0; }")` : ''}
${toolWhitelist.includes('file_read') || toolWhitelist.includes('*') ? `- file_read(path): Read content from a file. Example:
  file_read("config.json")` : ''}
${toolWhitelist.includes('bash_exec') || toolWhitelist.includes('*') ? `- bash_exec(command): Execute a shell command. Example:
  bash_exec("gcc hello.c -o hello")` : ''}
${toolWhitelist.includes('web_search') || toolWhitelist.includes('*') ? `- web_search(query): Search the web. Example:
  web_search("TypeScript best practices")` : ''}

IMPORTANT: When asked to create/write files, you MUST use file_write() with the actual file content. Do not just show the code - actually call the tool to create the file.`;
            systemPrompt += toolInstructions;
          }
          
          console.log(`[ExecutionWorker] Role ${agentRole} has tool whitelist: [${toolWhitelist.join(', ')}]`);

          // Get context from dependent tasks (for multi-agent workflows)
          let previousContext = '';
          console.log(`[ExecutionWorker] Task ${task.id} depends_on:`, task.depends_on, 'type:', typeof task.depends_on);
          
          // Ensure depends_on is properly parsed (PostgreSQL might return it as a string)
          let dependsOnArray: string[] = [];
          if (task.depends_on) {
            if (Array.isArray(task.depends_on)) {
              dependsOnArray = task.depends_on;
            } else if (typeof task.depends_on === 'string') {
              // Handle PostgreSQL array string format: {uuid1,uuid2}
              const cleaned = (task.depends_on as string).replace(/[{}]/g, '');
              dependsOnArray = cleaned ? cleaned.split(',') : [];
            }
          }
          
          console.log(`[ExecutionWorker] Parsed dependsOnArray:`, dependsOnArray, 'length:', dependsOnArray.length);
          
          if (dependsOnArray.length > 0) {
            console.log(`[ExecutionWorker] Querying for dependency tasks: run_id=${task.run_id}, depends_on=${JSON.stringify(dependsOnArray)}`);
            const dependentTasks = await pool.query(
              `SELECT id, COALESCE(agent_role_name, agent_role::text) as agent_role, output, state FROM tasks
               WHERE run_id = $1 AND id = ANY($2::uuid[]) AND state = 'SUCCEEDED'
               ORDER BY sequence_index ASC`,
              [task.run_id, dependsOnArray]
            );
            console.log(`[ExecutionWorker] Found ${dependentTasks.rows.length} completed dependency tasks`);
            
            // Debug: log all dependency task states
            const allDepTasks = await pool.query(
              `SELECT id, COALESCE(agent_role_name, agent_role::text) as agent_role, state FROM tasks
               WHERE run_id = $1 AND id = ANY($2::uuid[])`,
              [task.run_id, dependsOnArray]
            );
            console.log(`[ExecutionWorker] All dependency tasks (any state):`, allDepTasks.rows.map((t: any) => `${t.agent_role}:${t.state}`).join(', '));
            
            if (dependentTasks.rows.length > 0) {
              const validOutputs: string[] = [];
              const emptyOutputAgents: string[] = [];
              const malformedOutputAgents: string[] = [];
              
              for (const t of dependentTasks.rows) {
                let outputText = '';
                let isValid = true;
                console.log(`[ExecutionWorker] Processing dep task ${t.id}: output type=${typeof t.output}, output=${JSON.stringify(t.output)?.slice(0, 300)}`);
                
                if (typeof t.output === 'string') {
                  // Output stored as string directly
                  try {
                    const parsed = JSON.parse(t.output);
                    outputText = parsed.response || JSON.stringify(parsed);
                  } catch {
                    outputText = t.output;
                  }
                } else if (t.output?.response) {
                  // Output has response property (JSONB auto-parsed)
                  outputText = t.output.response;
                } else if (t.output) {
                  // Output is some other object
                  outputText = JSON.stringify(t.output);
                } else {
                  outputText = '';
                  isValid = false;
                }
                
                // IMPORTANT: Extract actual output from thinking models
                // Previous agents may have stored thinking in their output
                const extracted = extractActualOutput(outputText);
                if (extracted.thinking) {
                  console.log(`[ExecutionWorker] Stripped thinking (${extracted.thinking.length} chars) from ${t.agent_role} context`);
                  outputText = extracted.output;
                }
                
                // Validate output is not empty or malformed
                const trimmedOutput = outputText.trim();
                if (!trimmedOutput || trimmedOutput.length === 0) {
                  console.warn(`[ExecutionWorker] WARNING: Empty output from ${t.agent_role} (task ${t.id})`);
                  emptyOutputAgents.push(t.agent_role);
                  isValid = false;
                } else if (trimmedOutput.length < 10) {
                  // Output too short to be meaningful
                  console.warn(`[ExecutionWorker] WARNING: Very short output (${trimmedOutput.length} chars) from ${t.agent_role}: "${trimmedOutput}"`);
                  malformedOutputAgents.push(t.agent_role);
                  isValid = false;
                } else if (trimmedOutput === '(no output)' || trimmedOutput === 'null' || trimmedOutput === 'undefined') {
                  console.warn(`[ExecutionWorker] WARNING: Placeholder output from ${t.agent_role}: "${trimmedOutput}"`);
                  emptyOutputAgents.push(t.agent_role);
                  isValid = false;
                }
                
                // Check for malformed JSON (common issue with structured output)
                if (isValid && (trimmedOutput.startsWith('{') || trimmedOutput.startsWith('['))) {
                  try {
                    JSON.parse(trimmedOutput);
                  } catch (e) {
                    console.warn(`[ExecutionWorker] WARNING: Malformed JSON output from ${t.agent_role}: ${(e as Error).message}`);
                    malformedOutputAgents.push(t.agent_role);
                    // Still include it but mark as potentially malformed
                  }
                }
                
                if (isValid || trimmedOutput.length >= 10) {
                  console.log(`[ExecutionWorker]   - ${t.agent_role}: ${trimmedOutput.slice(0, 200)}...`);
                  validOutputs.push(`[${t.agent_role}]: ${trimmedOutput}`);
                }
              }
              
              // Log summary of output validation
              if (emptyOutputAgents.length > 0) {
                console.warn(`[ExecutionWorker] Agents with empty output: ${emptyOutputAgents.join(', ')}`);
              }
              if (malformedOutputAgents.length > 0) {
                console.warn(`[ExecutionWorker] Agents with malformed output: ${malformedOutputAgents.join(', ')}`);
              }
              
              if (validOutputs.length > 0) {
                previousContext = '\n\n--- CONTEXT FROM PREVIOUS AGENTS ---\n' +
                  validOutputs.join('\n\n') +
                  '\n--- END CONTEXT ---\n\n';
                console.log(`[ExecutionWorker] Task ${task.id} has context from ${validOutputs.length}/${dependentTasks.rows.length} previous tasks`);
                console.log(`[ExecutionWorker] previousContext length: ${previousContext.length} chars`);
              } else {
                console.error(`[ExecutionWorker] ERROR: All ${dependentTasks.rows.length} dependency tasks have empty/invalid output!`);
                previousContext = '\n\n--- CONTEXT FROM PREVIOUS AGENTS ---\n[WARNING: Previous agents produced no usable output. Please proceed based on the original request.]\n--- END CONTEXT ---\n\n';
              }
            } else {
              console.log(`[ExecutionWorker] WARNING: No SUCCEEDED dependency tasks found!`);
            }
          }

          // Build the user message:
          // - First agent (no dependencies): gets the original user prompt
          // - Dependent agents: get context from previous agents + instruction to continue the task
          const originalPrompt = task.input?.prompt || '';
          const taskRole = task.input?.role || agentRole;
          const isFirstTask = task.input?.isFirstTask || dependsOnArray.length === 0;
          const isLastTask = task.input?.isLastTask || false;
          
          // Build tool usage reminder for roles with tool access
          let toolReminder = '';
          if (hasToolAccess && toolWhitelist.length > 0) {
            const toolNames = toolWhitelist.join(', ');
            toolReminder = `

IMPORTANT: You have access to tools: [${toolNames}]
You MUST use these tools to complete the task. For example, to create a file use:
file_write("filename.ext", "file content here")

Do NOT just show code in your response - actually CALL file_write() to create the file!`;
          }
          
          let userMessage: string;
          
          if (dependsOnArray.length > 0 && previousContext) {
            // Dependent task: combine context with role-specific instruction
            // Add role-specific action verbs to prevent LLM confusion
            let actionInstruction = 'Complete your task as described.';
            const roleUpper = taskRole.toUpperCase();
            if (roleUpper.includes('CODE') || roleUpper.includes('WRITER') || roleUpper.includes('DEVELOPER') || roleUpper.includes('BUILDER')) {
              actionInstruction = `WRITE THE ACTUAL CODE. Do NOT describe what code to write - produce the real, working code files. Use file_write to create the source code files.`;
            } else if (roleUpper.includes('REVIEW') || roleUpper.includes('QA') || roleUpper.includes('TEST')) {
              actionInstruction = `Review the code/work from previous agents and provide feedback or corrections.`;
            } else if (roleUpper.includes('PLAN')) {
              actionInstruction = `Create a detailed plan or breakdown of the work to be done.`;
            }
            
            userMessage = `## Original User Request
${originalPrompt}

## Your Role: ${taskRole}
You are the ${taskRole} agent in a multi-agent workflow. ${isLastTask ? 'You are the FINAL agent - produce the complete, polished output.' : 'Process the input and produce output for the next agent.'}

**IMPORTANT: ${actionInstruction}**

${previousContext}

## Your Task
Based on the context from previous agents above, perform your role as ${taskRole}. 
${isLastTask ? 'Produce the final deliverable that fulfills the original user request.' : 'Process and enhance the work from previous agents, then pass it to the next agent.'}
Do NOT output JSON task descriptions. Do NOT simply repeat the previous output. ${roleUpper.includes('CODE') || roleUpper.includes('WRITER') || roleUpper.includes('BUILDER') ? 'Produce actual working code, not descriptions of code.' : 'Add value according to your role.'}${toolReminder}`;
            console.log(`[ExecutionWorker] Task ${task.id} (${taskRole}) using context + role instruction`);
          } else {
            // First task or no dependencies: use the original prompt with role context
            userMessage = `## User Request
${originalPrompt}

## Your Role: ${taskRole}
You are the ${taskRole} agent. ${isFirstTask ? 'You are the FIRST agent in the workflow - analyze the request and produce initial output.' : ''}
Perform your role and produce output that can be used by subsequent agents.${toolReminder}`;
            console.log(`[ExecutionWorker] Task ${task.id} (${taskRole}) using original prompt (first agent)`);
          }
          console.log(`[ExecutionWorker] Full user message length: ${userMessage.length} chars`);

          // Broadcast provider call start
          broadcast(task.run_id, {
            type: 'PROVIDER_CALL_STARTED',
            timestamp: new Date().toISOString(),
            payload: { 
              taskId: task.id, 
              role: task.agent_role,
              provider: providerName,
              model: modelName,
            }
          });

          // Execute the task via the provider
          const startTime = Date.now();
          let fullContent = '';
          let thinkingContent: string | null = null;  // Store thinking separately
          let actualContent = '';  // The actual output (after thinking)
          let tokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 };
          let toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> | undefined;
          let artifacts: Array<{ name: string; mimeType: string; path: string; sizeBytes: number; artifactId?: string }> = [];
          
          // Get tool definitions based on role's tool_whitelist (not hardcoded to BUILDER)
          const allTools = workerRuntime.getToolDefinitions();
          const tools = hasToolAccess ? allTools.filter(t => toolWhitelist.includes(t.name) || toolWhitelist.includes('*')) : undefined;
          
          // Roles with tool access use complete() to support tool calls; others use streaming
          if (hasToolAccess || !selected.adapter.stream) {
            // Use complete() for tool support
            const llmResult = await selected.adapter.complete({
              systemPrompt,
              userMessage,
              maxTokens: 4000,
              temperature: 0.7,
              tools,
            });
            fullContent = llmResult.content;
            tokenUsage = llmResult.tokenUsage || tokenUsage;
            toolCalls = llmResult.toolCalls;
            
            // Extract actual output from thinking models (separates thinking from actual response)
            const extracted = extractActualOutput(fullContent);
            thinkingContent = extracted.thinking;
            actualContent = extracted.output || fullContent;
            if (thinkingContent) {
              console.log(`[ExecutionWorker] Extracted thinking (${thinkingContent.length} chars) from actual output (${actualContent.length} chars)`);
            }
            
            // Fallback: parse text-based tool calls for models that don't support native tool calling
            // Look for patterns like: file_write("path", "content") or ```tool_code\nfile_write(...)\n```
            if ((!toolCalls || toolCalls.length === 0) && hasToolAccess && actualContent) {
              console.log(`[ExecutionWorker] No native tool calls, attempting text-based parsing. Output preview: ${actualContent.slice(0, 500)}...`);
              const textToolCalls = parseTextBasedToolCalls(actualContent);
              console.log(`[ExecutionWorker] Text parser found ${textToolCalls.length} tool calls:`, textToolCalls.map(tc => tc.name));
              // Filter to only allowed tools
              const allowedToolCalls = textToolCalls.filter(tc => 
                toolWhitelist.includes(tc.name) || toolWhitelist.includes('*')
              );
              if (allowedToolCalls.length > 0) {
                console.log(`[ExecutionWorker] Parsed ${allowedToolCalls.length} text-based tool calls from LLM output (${textToolCalls.length - allowedToolCalls.length} filtered by whitelist)`);
                toolCalls = allowedToolCalls;
              } else {
                console.log(`[ExecutionWorker] WARNING: LLM output has no tool calls. Model may not be following tool instructions.`);
              }
            }
            
            // If LLM returned tool calls, execute them
            if (toolCalls && toolCalls.length > 0) {
              console.log(`[ExecutionWorker] Task ${task.id} has ${toolCalls.length} tool calls`);
              
              for (const toolCall of toolCalls) {
                console.log(`[ExecutionWorker] Executing tool: ${toolCall.name}`, toolCall.arguments);
                
                // CRITICAL: Evaluate policy before tool execution (budget, approval, blocklist)
                const policyResult = await policyEngine.evaluateAction(
                  task.run_id, 
                  task.id, 
                  toolCall.name, 
                  toolCall.arguments as Record<string, unknown>
                );
                
                if (policyResult.decision === 'DENY') {
                  console.log(`[ExecutionWorker] Tool ${toolCall.name} DENIED by policy: ${policyResult.reason}`);
                  fullContent += `\n\n[Tool: ${toolCall.name}] DENIED: ${policyResult.reason}`;
                  broadcast(task.run_id, {
                    type: 'TOOL_EXECUTION_DENIED',
                    timestamp: new Date().toISOString(),
                    payload: { taskId: task.id, toolName: toolCall.name, reason: policyResult.reason }
                  });
                  continue; // Skip this tool, try next one
                }
                
                if (policyResult.decision === 'REQUIRE_APPROVAL') {
                  console.log(`[ExecutionWorker] Tool ${toolCall.name} requires approval`);
                  const approvalId = await policyEngine.createApproval(
                    task.run_id, task.id, toolCall.name, policyResult.riskLevel
                  );
                  
                  // Transition run to WAITING_APPROVAL and re-queue this task
                  try {
                    await stateMachine.transitionRunState(task.run_id, 'WAITING_APPROVAL', `Approval required for ${toolCall.name}`);
                  } catch { /* may already be in WAITING_APPROVAL */ }
                  
                  broadcast(task.run_id, {
                    type: 'APPROVAL_REQUIRED',
                    timestamp: new Date().toISOString(),
                    payload: { taskId: task.id, toolName: toolCall.name, approvalId, reason: policyResult.reason }
                  });
                  
                  // Stop processing this task - it will be re-queued when approval is granted
                  fullContent += `\n\n[Tool: ${toolCall.name}] WAITING_APPROVAL: ${policyResult.reason}`;
                  throw new Error(`APPROVAL_REQUIRED:${approvalId}`); // Will be caught and task re-queued
                }
                
                // Policy allows execution - proceed
                // Broadcast tool execution start
                broadcast(task.run_id, {
                  type: 'TOOL_EXECUTION_STARTED',
                  timestamp: new Date().toISOString(),
                  payload: { taskId: task.id, toolName: toolCall.name, args: toolCall.arguments }
                });
                
                const toolResult = await workerRuntime.executeTool({
                  taskId: task.id,
                  runId: task.run_id,
                  toolName: toolCall.name,
                  toolArgs: toolCall.arguments,
                });
                
                console.log(`[ExecutionWorker] Tool ${toolCall.name} result:`, toolResult.success ? 'success' : toolResult.error);
                
                // Broadcast tool execution result
                broadcast(task.run_id, {
                  type: 'TOOL_EXECUTION_COMPLETED',
                  timestamp: new Date().toISOString(),
                  payload: { 
                    taskId: task.id, 
                    toolName: toolCall.name, 
                    success: toolResult.success,
                    result: toolResult.result,
                    error: toolResult.error,
                  }
                });
                
                // Collect artifacts from tool results
                if (toolResult.artifacts) {
                  for (const artifact of toolResult.artifacts) {
                    artifacts.push({
                      ...artifact,
                      artifactId: (toolResult.result as { artifactId?: string })?.artifactId,
                    });
                  }
                }
                
                // Append tool result to content for context
                fullContent += `\n\n[Tool: ${toolCall.name}] ${toolResult.success ? 'Success' : 'Failed'}: ${JSON.stringify(toolResult.result || toolResult.error)}`;
              }
            }
          } else {
            // Use streaming for non-BUILDER roles
            try {
              for await (const chunk of selected.adapter.stream({
                systemPrompt,
                userMessage,
                maxTokens: 4000,
                temperature: 0.7,
              })) {
                fullContent += chunk.content;
                
                // Broadcast each chunk in real-time
                broadcast(task.run_id, {
                  type: 'PROVIDER_STREAM_CHUNK',
                  timestamp: new Date().toISOString(),
                  payload: {
                    taskId: task.id,
                    role: task.agent_role,
                    chunk: chunk.content,
                    done: chunk.done,
                  }
                });
              }
              // Bug 4 fix: Calculate totalTokens correctly in one statement
              const promptToks = Math.ceil((systemPrompt.length + userMessage.length) / 4);
              const completionToks = Math.ceil(fullContent.length / 4);
              tokenUsage = {
                promptTokens: promptToks,
                completionTokens: completionToks,
                totalTokens: promptToks + completionToks,
                costUsd: 0, // Local = free
              };
            } catch (streamErr) {
              console.log(`[ExecutionWorker] Streaming failed, falling back to complete(): ${(streamErr as Error).message}`);
              const llmResult = await selected.adapter.complete({
                systemPrompt,
                userMessage,
                maxTokens: 4000,
                temperature: 0.7,
              });
              fullContent = llmResult.content;
              tokenUsage = llmResult.tokenUsage || tokenUsage;
            }
          }
          
          const durationMs = Date.now() - startTime;

          console.log(`[ExecutionWorker] Task ${task.id} completed, ${tokenUsage.totalTokens || 0} tokens used, ${artifacts.length} artifacts`);

          // Broadcast provider call completion with output
          broadcast(task.run_id, {
            type: 'PROVIDER_CALL_COMPLETED',
            timestamp: new Date().toISOString(),
            payload: { 
              taskId: task.id, 
              role: task.agent_role,
              provider: providerName,
              model: modelName,
              output: actualContent || fullContent,  // Use actual output (without thinking)
              thinking: thinkingContent || undefined,  // Store thinking separately
              tokens: tokenUsage.totalTokens || 0,
              durationMs,
              artifacts: artifacts.length > 0 ? artifacts : undefined,
            }
          });

          // Mark task as completed - store actual output (not thinking) as the response
          // The thinking is stored in the broadcast but not in the task output for cleaner context passing
          const outputToStore = actualContent || fullContent;
          
          // Validate output before storing
          const trimmedOutput = outputToStore?.trim() || '';
          if (!trimmedOutput || trimmedOutput.length === 0) {
            console.warn(`[ExecutionWorker] WARNING: Task ${task.id} (${agentRole}) produced empty output!`);
          } else if (trimmedOutput.length < 20) {
            console.warn(`[ExecutionWorker] WARNING: Task ${task.id} (${agentRole}) produced very short output (${trimmedOutput.length} chars): "${trimmedOutput}"`);
          } else {
            console.log(`[ExecutionWorker] Task ${task.id} (${agentRole}) produced valid output (${trimmedOutput.length} chars)`);
          }
          
          console.log(`[ExecutionWorker] Calling completeTask for ${task.id}...`);
          await taskBroker.completeTask(task.id, {
            response: outputToStore,  // Use actual output for downstream agents
            provider: providerName,
            artifacts: artifacts.length > 0 ? artifacts : undefined,
          }, tokenUsage);
          console.log(`[ExecutionWorker] completeTask succeeded for ${task.id}`);

          // Broadcast task completion
          broadcast(task.run_id, {
            type: 'TASK_STATE_CHANGED',
            timestamp: new Date().toISOString(),
            payload: { taskId: task.id, newState: 'SUCCEEDED' }
          });
          console.log(`[ExecutionWorker] Broadcast SUCCEEDED for ${task.id}`);

          // Bug 7 fix: Queue dependent tasks and check completion in a single transaction
          // This prevents race conditions where a task is in between states
          const completionClient = await pool.connect();
          try {
            await completionClient.query('BEGIN');
            
            // Queue tasks whose dependencies are now met (critical for multi-agent workflows)
            const queuedResult = await completionClient.query(`
              UPDATE tasks SET state = 'QUEUED', updated_at = NOW()
              WHERE run_id = $1 
              AND state = 'PENDING'
              AND NOT EXISTS (
                SELECT 1 FROM tasks dep
                WHERE dep.id = ANY(tasks.depends_on)
                AND dep.state NOT IN ('SUCCEEDED', 'SKIPPED')
              )
              RETURNING id
            `, [task.run_id]);
            const queuedCount = queuedResult.rowCount || 0;
            
            if (queuedCount > 0) {
              console.log(`[ExecutionWorker] Queued ${queuedCount} dependent tasks after ${agentRole} completed`);
            }

            // Bug 2 fix: Check completion excluding tasks that are being retried (QUEUED after failure)
            // A run is complete only if ALL tasks are in terminal states AND no retries pending
            const completionCheck = await completionClient.query(`
              SELECT 
                COUNT(*) FILTER (WHERE state IN ('SUCCEEDED', 'SKIPPED')) as succeeded,
                COUNT(*) FILTER (WHERE state = 'FAILED') as failed,
                COUNT(*) FILTER (WHERE state IN ('PENDING', 'QUEUED', 'DISPATCHED', 'RUNNING')) as in_progress,
                COUNT(*) as total
              FROM tasks WHERE run_id = $1
            `, [task.run_id]);
            
            await completionClient.query('COMMIT');
            
            const stats = completionCheck.rows[0];
            const succeeded = parseInt(stats.succeeded, 10);
            const failed = parseInt(stats.failed, 10);
            const inProgress = parseInt(stats.in_progress, 10);
            const total = parseInt(stats.total, 10);
            
            console.log(`[ExecutionWorker] Run ${task.run_id} status: ${succeeded} succeeded, ${failed} failed, ${inProgress} in progress, ${total} total`);
            
            // Broadcast queued tasks
            if (queuedCount > 0) {
              broadcast(task.run_id, {
                type: 'TASKS_QUEUED',
                timestamp: new Date().toISOString(),
                payload: { runId: task.run_id, count: queuedCount }
              });
            }
            
            // Only transition if no tasks in progress (prevents race condition)
            if (inProgress === 0) {
              if (failed === 0 && succeeded > 0) {
                // Create final checkpoint before completion
                try {
                  await checkpointManager.createCheckpoint(task.run_id);
                } catch { /* best-effort checkpoint */ }
                
                await stateMachine.transitionRunState(task.run_id, 'COMPLETED', 'All tasks completed successfully');
                broadcast(task.run_id, {
                  type: 'RUN_STATE_CHANGED',
                  timestamp: new Date().toISOString(),
                  payload: { runId: task.run_id, newState: 'COMPLETED' }
                });
                console.log(`[ExecutionWorker] Run ${task.run_id} completed successfully`);
              } else if (failed > 0) {
                // Create checkpoint before failure for recovery
                try {
                  await checkpointManager.createCheckpoint(task.run_id);
                } catch { /* best-effort checkpoint */ }
                
                await stateMachine.transitionRunState(task.run_id, 'FAILED', 'One or more tasks failed');
                broadcast(task.run_id, {
                  type: 'RUN_STATE_CHANGED',
                  timestamp: new Date().toISOString(),
                  payload: { runId: task.run_id, newState: 'FAILED' }
                });
                console.log(`[ExecutionWorker] Run ${task.run_id} failed`);
              }
            }
          } catch (completionErr) {
            await completionClient.query('ROLLBACK');
            console.error(`[ExecutionWorker] Completion check failed for run ${task.run_id}:`, completionErr);
          } finally {
            completionClient.release();
          }

        } catch (err: any) {
          const errMsg = err.message || '';
          
          // Special handling for approval required - don't fail the task
          if (errMsg.startsWith('APPROVAL_REQUIRED:')) {
            console.log(`[ExecutionWorker] Task ${task.id} waiting for approval`);
            // Task stays in RUNNING state, run is in WAITING_APPROVAL
            // When approval is granted, task will be re-queued via approvals.ts
            processingTasks.delete(task.id);
            continue; // Don't fail the task
          }
          
          console.error(`[ExecutionWorker] Task ${task.id} execution failed:`, errMsg);
          
          // Classify error type for proper retry handling
          let failureType = 'INTERNAL_ERROR';
          const errMsgLower = errMsg.toLowerCase();
          if (errMsgLower.includes('timeout') || errMsgLower.includes('aborted') || err.name === 'TimeoutError' || err.name === 'AbortError') {
            failureType = 'TIMEOUT';
          } else if (errMsgLower.includes('fetch failed') || errMsgLower.includes('econnrefused') || errMsgLower.includes('network') || errMsgLower.includes('500')) {
            failureType = 'PROVIDER_ERROR';
          } else if (err.status === 429 || errMsgLower.includes('rate limit')) {
            failureType = 'PROVIDER_ERROR';
          }
          
          const willRetry = await taskBroker.failTask(task.id, failureType, errMsg);
          
          if (willRetry) {
            // Task was re-queued for retry - broadcast the re-queue event
            broadcast(task.run_id, {
              type: 'TASK_STATE_CHANGED',
              timestamp: new Date().toISOString(),
              payload: { taskId: task.id, newState: 'QUEUED', retrying: true }
            });
            console.log(`[ExecutionWorker] Task ${task.id} will be retried`);
          } else {
            // Terminal failure
            broadcast(task.run_id, {
              type: 'PROVIDER_CALL_FAILED',
              timestamp: new Date().toISOString(),
              payload: { taskId: task.id, error: errMsg, failureType }
            });
            broadcast(task.run_id, {
              type: 'TASK_STATE_CHANGED',
              timestamp: new Date().toISOString(),
              payload: { taskId: task.id, newState: 'FAILED', error: errMsg }
            });
          }
        } finally {
          // Always remove from processing set when done
          processingTasks.delete(task.id);
        }
      }
    } catch (err: any) {
      console.error('[ExecutionWorker] Error in execution worker:', err.message);
    }
  }, EXECUTION_INTERVAL);
}

export { stateMachine, taskBroker, checkpointManager, deadLetterHandler, policyEngine, workerRuntime, providerRouter, artifactStore };
