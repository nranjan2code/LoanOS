import {
  assignWorkflowTask,
  commentOnWorkflowTask,
  deriveWorkflowTasks,
  releaseWorkflowTask,
  startWorkflowTask,
  summarizeFindings,
  validateWorkflowActorAccess,
  validateWorkflowAssignmentAccess
} from "@loanos/core";

const GOVERNED_ADMIN_ROLES = new Set(["tenant_admin", "security_admin", "auditor", "operator"]);

export async function routeWorkflowTasks(context) {
  const { method, path, url, req, res, store, readJson, sendJson, appendEvent, authContext, resolveSessionActorId } = context;
  if (path !== "/workflow/tasks" && !path.startsWith("/workflow/tasks/")) return false;

  if (method === "GET" && path === "/workflow/tasks") {
    const state = await store.load();
    const asOf = url.searchParams.get("asOf") ? new Date(url.searchParams.get("asOf")) : new Date();
    const tasks = deriveWorkflowTasks(state, { asOf, filters: taskFiltersFromUrl(url) })
      .filter((task) => canReadTask(state.users, task, authContext));
    sendJson(res, 200, { asOf: asOf.toISOString(), count: tasks.length, tasks });
    return true;
  }

  const taskMatch = path.match(/^\/workflow\/tasks\/([^/]+)$/);
  if (method === "GET" && taskMatch) {
    const state = await store.load();
    const taskId = decodeURIComponent(taskMatch[1]);
    const asOf = url.searchParams.get("asOf") ? new Date(url.searchParams.get("asOf")) : new Date();
    const task = deriveWorkflowTasks(state, { asOf }).find((candidate) => candidate.taskId === taskId);
    if (!task || !canReadTask(state.users, task, authContext)) sendJson(res, 404, { error: { code: "not_found", message: "Workflow task not found or no longer active." } });
    else sendJson(res, 200, task);
    return true;
  }

  const actionMatch = path.match(/^\/workflow\/tasks\/([^/]+)\/(assignments|start|release|comments)$/);
  if (method !== "POST" || !actionMatch) return false;

  const body = await readJson(req);
  const state = await store.load();
  const taskId = decodeURIComponent(actionMatch[1]);
  const action = actionMatch[2];
  const asOf = body.asOf ? new Date(body.asOf) : new Date();
  const activeTasks = deriveWorkflowTasks(state, { asOf });
  const activeTask = activeTasks.find((task) => task.taskId === taskId) ?? null;
  if (action === "assignments") body.assignedBy = resolveSessionActorId(authContext, body.assignedBy);
  else body.actor = resolveSessionActorId(authContext, body.actor);

  const accessFindings = action === "assignments"
    ? validateWorkflowAssignmentAccess(state.users, activeTask, body)
    : validateWorkflowActorAccess(state.users, activeTask, body.actor, "actor");
  if (summarizeFindings(accessFindings).status === "blocked") {
    sendJson(res, 422, { error: { code: "workflow_task_access_blocked", message: "Workflow task action is blocked by actor role or queue access." }, findings: accessFindings });
    return true;
  }

  const taskAction = action === "assignments"
    ? assignWorkflowTask
    : action === "start"
      ? startWorkflowTask
      : action === "release"
        ? releaseWorkflowTask
        : commentOnWorkflowTask;
  const result = taskAction(state.workflowTasks, taskId, body, activeTasks);
  if (result.summary.status === "blocked") {
    sendJson(res, 422, { error: { code: "workflow_task_blocked", message: "Workflow task action is blocked by control findings." }, findings: result.findings });
    return true;
  }

  await store.save(appendEvent({ ...state, workflowTasks: result.workflowTasks }, {
    type: result.event.type,
    taskId,
    actor: body.actor ?? body.assignedBy ?? null
  }));
  sendJson(res, action === "assignments" ? 201 : 200, { task: result.task, event: result.event });
  return true;
}

function canReadTask(users, task, authContext) {
  if (authContext?.principalType !== "tenant_user") return true;
  const user = users?.[authContext.userId];
  const adminRoles = [...(authContext.roles ?? []), ...(user?.adminRoles ?? [])];
  if (adminRoles.some((role) => GOVERNED_ADMIN_ROLES.has(role)) || user?.roles?.includes("workflow_admin")) return true;
  return summarizeFindings(validateWorkflowActorAccess(users, task, authContext.userId, "actor")).status !== "blocked";
}

function taskFiltersFromUrl(url) {
  const filters = {};
  for (const key of ["queue", "status", "type", "entityType", "assignedTo", "slaStatus"]) {
    const value = url.searchParams.get(key);
    if (value) filters[key] = value;
  }
  return filters;
}
