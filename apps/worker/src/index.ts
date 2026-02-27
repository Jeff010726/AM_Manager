import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { sign, verify } from 'hono/jwt';
import { z } from 'zod';

type Env = {
  DB: D1Database;
  JWT_SECRET: string;
  CORS_ORIGIN?: string;
};

type AuthUser = {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'visitor';
};

type AppBindings = {
  Bindings: Env;
  Variables: {
    authUser: AuthUser;
    requestId: string;
  };
};

const app = new Hono<AppBindings>();

const projectStatusEnum = z.enum(['planned', 'active', 'blocked', 'done', 'cancelled']);

app.use('*', async (c, next) => {
  const requestId = c.req.header('x-request-id') || crypto.randomUUID();
  c.set('requestId', requestId);
  await next();
  c.header('x-request-id', requestId);
});

app.use('*', async (c, next) => {
  return cors({
    origin: c.env.CORS_ORIGIN || '*',
    allowHeaders: ['Content-Type', 'Authorization', 'x-request-id'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['x-request-id'],
    maxAge: 86400,
  })(c, next);
});

app.use('/api/*', async (c, next) => {
  if (c.req.method === 'OPTIONS') return c.body(null, 204);
  if (c.req.path === '/api/health' || c.req.path === '/api/auth/login') return next();

  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) return apiError(c, 401, 'UNAUTHORIZED', 'Missing bearer token');

  try {
    const payload = await verify(header.slice(7), c.env.JWT_SECRET, 'HS256');
    c.set('authUser', {
      id: Number(payload.sub),
      email: String(payload.email),
      name: String(payload.name),
      role: payload.role === 'admin' ? 'admin' : 'visitor',
    });
    return next();
  } catch {
    return apiError(c, 401, 'UNAUTHORIZED', 'Invalid token');
  }
});

app.onError((err, c) => {
  console.error('Unhandled error', err);
  return apiError(c, 500, 'INTERNAL_ERROR', 'Unexpected server error');
});

app.get('/api/health', (c) => {
  return c.json({ success: true, data: { status: 'ok', request_id: c.get('requestId'), ts: now() } });
});

app.post('/api/auth/login', async (c) => {
  const schema = z.object({ email: z.string().email(), password: z.string().min(6) });
  const body = schema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return apiError(c, 400, 'INVALID_PARAMS', body.error.issues[0]?.message || 'Invalid payload');

  const user = await c.env.DB.prepare(
    'SELECT id, email, name, role, password_hash, status FROM users WHERE email = ?',
  )
    .bind(body.data.email)
    .first<{ id: number; email: string; name: string; role: 'admin' | 'visitor'; password_hash: string; status: string }>();

  if (!user || user.status !== 'active') {
    return apiError(c, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const hash = await sha256(body.data.password);
  if (hash !== user.password_hash) {
    return apiError(c, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const token = await sign(
    {
      sub: String(user.id),
      email: user.email,
      name: user.name,
      role: user.role,
      exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
    },
    c.env.JWT_SECRET,
    'HS256',
  );

  return c.json({
    success: true,
    data: {
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    },
  });
});

app.get('/api/auth/me', (c) => c.json({ success: true, data: c.get('authUser') }));

app.get('/api/users', async (c) => {
  const guard = requireAdmin(c);
  if (guard) return guard;
  const rows = await c.env.DB.prepare(
    'SELECT id, email, name, role, status, created_at, updated_at FROM users ORDER BY id ASC',
  ).all();
  return c.json({ success: true, data: rows.results || [] });
});

app.post('/api/users', async (c) => {
  const guard = requireAdmin(c);
  if (guard) return guard;

  const schema = z.object({
    email: z.string().email(),
    name: z.string().min(1),
    password: z.string().min(6),
    role: z.enum(['admin', 'visitor']),
  });
  const body = schema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return apiError(c, 400, 'INVALID_PARAMS', body.error.issues[0]?.message || 'Invalid payload');

  try {
    const run = await c.env.DB.prepare(
      'INSERT INTO users (email, name, role, password_hash, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(body.data.email, body.data.name, body.data.role, await sha256(body.data.password), 'active', now(), now())
      .run();

    const id = Number(run.meta.last_row_id);
    await writeAudit(c, 'user.create', 'user', String(id), null, body.data);
    return c.json({ success: true, data: { id } }, 201);
  } catch (error) {
    if (String(error).includes('UNIQUE')) return apiError(c, 409, 'EMAIL_EXISTS', 'Email already exists');
    throw error;
  }
});

app.put('/api/users/:id/role', async (c) => {
  const guard = requireAdmin(c);
  if (guard) return guard;

  const schema = z.object({ role: z.enum(['admin', 'visitor']) });
  const body = schema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return apiError(c, 400, 'INVALID_PARAMS', body.error.issues[0]?.message || 'Invalid payload');

  const userId = Number(c.req.param('id'));
  const before = await c.env.DB.prepare('SELECT id, role FROM users WHERE id = ?').bind(userId).first();
  if (!before) return apiError(c, 404, 'NOT_FOUND', 'User not found');

  await c.env.DB.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').bind(body.data.role, now(), userId).run();
  await writeAudit(c, 'user.update_role', 'user', String(userId), before, body.data);
  return c.json({ success: true, data: { id: userId, role: body.data.role } });
});

app.get('/api/categories', async (c) => {
  const rows = await c.env.DB.prepare('SELECT id, name, parent_id, created_at, updated_at FROM categories ORDER BY id ASC').all();
  return c.json({ success: true, data: rows.results || [] });
});

app.post('/api/categories', async (c) => {
  const guard = requireAdmin(c);
  if (guard) return guard;

  const schema = z.object({ name: z.string().min(1), parent_id: z.number().int().positive().nullable().optional() });
  const body = schema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return apiError(c, 400, 'INVALID_PARAMS', body.error.issues[0]?.message || 'Invalid payload');

  const run = await c.env.DB.prepare('INSERT INTO categories (name, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .bind(body.data.name, body.data.parent_id ?? null, now(), now())
    .run();
  const id = Number(run.meta.last_row_id);
  await writeAudit(c, 'category.create', 'category', String(id), null, body.data);
  return c.json({ success: true, data: { id } }, 201);
});

app.put('/api/categories/:id', async (c) => {
  const guard = requireAdmin(c);
  if (guard) return guard;

  const schema = z.object({ name: z.string().min(1), parent_id: z.number().int().positive().nullable().optional() });
  const body = schema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return apiError(c, 400, 'INVALID_PARAMS', body.error.issues[0]?.message || 'Invalid payload');

  const categoryId = Number(c.req.param('id'));
  const before = await c.env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(categoryId).first();
  if (!before) return apiError(c, 404, 'NOT_FOUND', 'Category not found');

  await c.env.DB.prepare('UPDATE categories SET name = ?, parent_id = ?, updated_at = ? WHERE id = ?')
    .bind(body.data.name, body.data.parent_id ?? null, now(), categoryId)
    .run();
  await writeAudit(c, 'category.update', 'category', String(categoryId), before, body.data);
  return c.json({ success: true, data: { id: categoryId } });
});

app.get('/api/products', async (c) => {
  const q = (c.req.query('q') || '').trim();
  const rows = await c.env.DB.prepare(
    `SELECT p.id, p.sku, p.name, p.category_id, c.name AS category_name, p.unit, p.spec, p.safety_stock_qty, p.status,
            COALESCE(b.on_hand_qty, 0) AS on_hand_qty, COALESCE(b.in_transit_qty, 0) AS in_transit_qty,
            COALESCE(b.reserved_qty, 0) AS reserved_qty, COALESCE(b.consumed_qty, 0) AS consumed_qty
     FROM products p
     JOIN categories c ON c.id = p.category_id
     LEFT JOIN inventory_balances b ON b.product_id = p.id
     WHERE (? = '' OR p.sku LIKE '%' || ? || '%' OR p.name LIKE '%' || ? || '%')
     ORDER BY p.id DESC`,
  )
    .bind(q, q, q)
    .all();
  return c.json({ success: true, data: (rows.results || []).map(mapInventoryLike) });
});

app.post('/api/products', async (c) => {
  const guard = requireAdmin(c);
  if (guard) return guard;

  const schema = z.object({
    sku: z.string().min(1),
    name: z.string().min(1),
    category_id: z.number().int().positive(),
    unit: z.string().min(1),
    spec: z.string().optional().nullable(),
    safety_stock_qty: z.number().int().min(0).default(0),
    status: z.enum(['active', 'inactive']).default('active'),
  });
  const body = schema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return apiError(c, 400, 'INVALID_PARAMS', body.error.issues[0]?.message || 'Invalid payload');

  if (!(await existsById(c.env.DB, 'categories', body.data.category_id))) {
    return apiError(c, 404, 'NOT_FOUND', 'Category not found');
  }

  try {
    const run = await c.env.DB.prepare(
      `INSERT INTO products (sku, name, category_id, unit, spec, safety_stock_qty, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        body.data.sku,
        body.data.name,
        body.data.category_id,
        body.data.unit,
        body.data.spec ?? null,
        body.data.safety_stock_qty,
        body.data.status,
        now(),
        now(),
      )
      .run();
    const id = Number(run.meta.last_row_id);
    await ensureBalanceRow(c.env.DB, id);
    await writeAudit(c, 'product.create', 'product', String(id), null, body.data);
    return c.json({ success: true, data: { id } }, 201);
  } catch (error) {
    if (String(error).includes('UNIQUE')) return apiError(c, 409, 'SKU_EXISTS', 'SKU already exists');
    throw error;
  }
});

app.put('/api/products/:id', async (c) => {
  const guard = requireAdmin(c);
  if (guard) return guard;

  const productId = Number(c.req.param('id'));
  const before = await c.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(productId).first();
  if (!before) return apiError(c, 404, 'NOT_FOUND', 'Product not found');

  const schema = z.object({
    name: z.string().min(1),
    category_id: z.number().int().positive(),
    unit: z.string().min(1),
    spec: z.string().optional().nullable(),
    safety_stock_qty: z.number().int().min(0),
    status: z.enum(['active', 'inactive']),
  });
  const body = schema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return apiError(c, 400, 'INVALID_PARAMS', body.error.issues[0]?.message || 'Invalid payload');

  if (!(await existsById(c.env.DB, 'categories', body.data.category_id))) {
    return apiError(c, 404, 'NOT_FOUND', 'Category not found');
  }

  await c.env.DB.prepare(
    `UPDATE products
     SET name = ?, category_id = ?, unit = ?, spec = ?, safety_stock_qty = ?, status = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      body.data.name,
      body.data.category_id,
      body.data.unit,
      body.data.spec ?? null,
      body.data.safety_stock_qty,
      body.data.status,
      now(),
      productId,
    )
    .run();
  await writeAudit(c, 'product.update', 'product', String(productId), before, body.data);
  return c.json({ success: true, data: { id: productId } });
});

app.get('/api/projects', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT p.id, p.project_code, p.project_name, p.status, p.owner_user_id, u.name AS owner_name, p.start_date, p.end_date, p.note, p.created_at, p.updated_at
     FROM projects p
     JOIN users u ON u.id = p.owner_user_id
     ORDER BY p.id DESC`,
  ).all();
  return c.json({ success: true, data: rows.results || [] });
});

app.post('/api/projects', async (c) => {
  const guard = requireAdmin(c);
  if (guard) return guard;

  const schema = z.object({
    project_code: z.string().min(1),
    project_name: z.string().min(1),
    owner_user_id: z.number().int().positive(),
    status: projectStatusEnum.default('planned'),
    start_date: z.string().optional().nullable(),
    end_date: z.string().optional().nullable(),
    note: z.string().optional().nullable(),
  });
  const body = schema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return apiError(c, 400, 'INVALID_PARAMS', body.error.issues[0]?.message || 'Invalid payload');

  if (!(await existsById(c.env.DB, 'users', body.data.owner_user_id))) {
    return apiError(c, 404, 'NOT_FOUND', 'Owner user not found');
  }

  try {
    const run = await c.env.DB.prepare(
      `INSERT INTO projects
       (project_code, project_name, status, owner_user_id, start_date, end_date, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        body.data.project_code,
        body.data.project_name,
        body.data.status,
        body.data.owner_user_id,
        body.data.start_date ?? null,
        body.data.end_date ?? null,
        body.data.note ?? null,
        now(),
        now(),
      )
      .run();
    const id = Number(run.meta.last_row_id);
    await writeAudit(c, 'project.create', 'project', String(id), null, body.data);
    return c.json({ success: true, data: { id } }, 201);
  } catch (error) {
    if (String(error).includes('UNIQUE')) return apiError(c, 409, 'PROJECT_CODE_EXISTS', 'Project code already exists');
    throw error;
  }
});

app.get('/api/projects/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare(
    `SELECT p.id, p.project_code, p.project_name, p.status, p.owner_user_id, u.name AS owner_name, p.start_date, p.end_date, p.note, p.created_at, p.updated_at
     FROM projects p
     JOIN users u ON u.id = p.owner_user_id
     WHERE p.id = ?`,
  )
    .bind(id)
    .first();
  if (!row) return apiError(c, 404, 'NOT_FOUND', 'Project not found');
  return c.json({ success: true, data: row });
});

app.put('/api/projects/:id', async (c) => {
  const guard = requireAdmin(c);
  if (guard) return guard;

  const id = Number(c.req.param('id'));
  const before = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();
  if (!before) return apiError(c, 404, 'NOT_FOUND', 'Project not found');

  const schema = z.object({
    project_name: z.string().min(1),
    owner_user_id: z.number().int().positive(),
    start_date: z.string().optional().nullable(),
    end_date: z.string().optional().nullable(),
    note: z.string().optional().nullable(),
  });
  const body = schema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return apiError(c, 400, 'INVALID_PARAMS', body.error.issues[0]?.message || 'Invalid payload');

  if (!(await existsById(c.env.DB, 'users', body.data.owner_user_id))) {
    return apiError(c, 404, 'NOT_FOUND', 'Owner user not found');
  }

  await c.env.DB.prepare(
    `UPDATE projects
     SET project_name = ?, owner_user_id = ?, start_date = ?, end_date = ?, note = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(body.data.project_name, body.data.owner_user_id, body.data.start_date ?? null, body.data.end_date ?? null, body.data.note ?? null, now(), id)
    .run();
  await writeAudit(c, 'project.update', 'project', String(id), before, body.data);
  return c.json({ success: true, data: { id } });
});

app.post('/api/projects/:id/material-plans', async (c) => {
  const guard = requireAdmin(c);
  if (guard) return guard;

  const id = Number(c.req.param('id'));
  const schema = z.object({ product_id: z.number().int().positive(), planned_qty: z.number().int().min(0) });
  const body = schema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return apiError(c, 400, 'INVALID_PARAMS', body.error.issues[0]?.message || 'Invalid payload');

  if (!(await existsById(c.env.DB, 'projects', id))) return apiError(c, 404, 'NOT_FOUND', 'Project not found');
  if (!(await existsById(c.env.DB, 'products', body.data.product_id))) return apiError(c, 404, 'NOT_FOUND', 'Product not found');

  await c.env.DB.prepare(
    `INSERT INTO project_material_plans (project_id, product_id, planned_qty, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(project_id, product_id) DO UPDATE SET planned_qty = excluded.planned_qty, updated_at = excluded.updated_at`,
  )
    .bind(id, body.data.product_id, body.data.planned_qty, now(), now())
    .run();
  await writeAudit(c, 'project_material_plan.upsert', 'project', String(id), null, body.data);
  return c.json({ success: true, data: { project_id: id, ...body.data } });
});

app.get('/api/projects/:id/materials', async (c) => {
  const id = Number(c.req.param('id'));
  if (!(await existsById(c.env.DB, 'projects', id))) return apiError(c, 404, 'NOT_FOUND', 'Project not found');
  const rows = await c.env.DB.prepare(
    `SELECT pmp.product_id, p.sku, p.name, p.unit, pmp.planned_qty,
            COALESCE(SUM(pr.qty), 0) AS reserved_qty,
            COALESCE(SUM(pc.qty), 0) AS consumed_qty,
            COALESCE(SUM(pr.qty), 0) - COALESCE(SUM(pc.qty), 0) AS remaining_reserved_qty
     FROM project_material_plans pmp
     JOIN products p ON p.id = pmp.product_id
     LEFT JOIN project_reservations pr ON pr.project_id = pmp.project_id AND pr.product_id = pmp.product_id
     LEFT JOIN project_consumptions pc ON pc.project_id = pmp.project_id AND pc.product_id = pmp.product_id
     WHERE pmp.project_id = ?
     GROUP BY pmp.product_id, p.sku, p.name, p.unit, pmp.planned_qty
     ORDER BY pmp.product_id`,
  )
    .bind(id)
    .all();
  return c.json({ success: true, data: rows.results || [] });
});
app.get('/api/projects/:id/members', async (c) => {
  const projectId = Number(c.req.param('id'));
  const rows = await c.env.DB.prepare(
    `SELECT pm.user_id, u.name, u.email, u.role AS system_role, pm.project_role, pm.joined_at,
            (SELECT MAX(pc.created_at) FROM project_commits pc WHERE pc.project_id = pm.project_id AND pc.author_user_id = pm.user_id) AS last_commit_at
     FROM project_members pm
     JOIN users u ON u.id = pm.user_id
     WHERE pm.project_id = ?
     ORDER BY pm.joined_at ASC`,
  )
    .bind(projectId)
    .all();
  return c.json({ success: true, data: rows.results || [] });
});

app.get('/api/projects/:id/reservations', async (c) => {
  const id = Number(c.req.param('id'));
  if (!(await existsById(c.env.DB, 'projects', id))) return apiError(c, 404, 'NOT_FOUND', 'Project not found');
  const rows = await c.env.DB.prepare(
    `SELECT pr.id AS reservation_id, pr.project_id, pr.product_id, p.sku, p.name AS product_name, p.unit,
            pr.qty, pr.consumed_qty, pr.released_qty,
            (pr.qty - pr.consumed_qty - pr.released_qty) AS remaining_qty,
            pr.status, pr.created_at, pr.updated_at
     FROM project_reservations pr
     JOIN products p ON p.id = pr.product_id
     WHERE pr.project_id = ?
     ORDER BY pr.id DESC`,
  )
    .bind(id)
    .all();
  return c.json({ success: true, data: rows.results || [] });
});

app.post('/api/projects/:id/members', async (c) => {
  const guard = requireAdmin(c);
  if (guard) return guard;

  const projectId = Number(c.req.param('id'));
  const schema = z.object({ user_id: z.number().int().positive(), project_role: z.string().min(1) });
  const body = schema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return apiError(c, 400, 'INVALID_PARAMS', body.error.issues[0]?.message || 'Invalid payload');

  if (!(await existsById(c.env.DB, 'projects', projectId))) return apiError(c, 404, 'NOT_FOUND', 'Project not found');
  if (!(await existsById(c.env.DB, 'users', body.data.user_id))) return apiError(c, 404, 'NOT_FOUND', 'User not found');

  try {
    await c.env.DB.prepare('INSERT INTO project_members (project_id, user_id, project_role, joined_at) VALUES (?, ?, ?, ?)')
      .bind(projectId, body.data.user_id, body.data.project_role, now())
      .run();
  } catch (error) {
    if (String(error).includes('UNIQUE')) return apiError(c, 409, 'MEMBER_EXISTS', 'User is already in this project');
    throw error;
  }
  await writeAudit(c, 'project_member.create', 'project', String(projectId), null, body.data);
  return c.json({ success: true, data: body.data }, 201);
});

app.put('/api/projects/:id/members/:userId', async (c) => {
  const guard = requireAdmin(c);
  if (guard) return guard;

  const projectId = Number(c.req.param('id'));
  const userId = Number(c.req.param('userId'));
  const schema = z.object({ project_role: z.string().min(1) });
  const body = schema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return apiError(c, 400, 'INVALID_PARAMS', body.error.issues[0]?.message || 'Invalid payload');

  const run = await c.env.DB.prepare('UPDATE project_members SET project_role = ? WHERE project_id = ? AND user_id = ?')
    .bind(body.data.project_role, projectId, userId)
    .run();
  if ((run.meta.changes ?? 0) === 0) return apiError(c, 404, 'NOT_FOUND', 'Project member not found');
  await writeAudit(c, 'project_member.update_role', 'project', String(projectId), null, { user_id: userId, ...body.data });
  return c.json({ success: true, data: { user_id: userId, ...body.data } });
});

app.delete('/api/projects/:id/members/:userId', async (c) => {
  const guard = requireAdmin(c);
  if (guard) return guard;
  const projectId = Number(c.req.param('id'));
  const userId = Number(c.req.param('userId'));

  await c.env.DB.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').bind(projectId, userId).run();
  await writeAudit(c, 'project_member.delete', 'project', String(projectId), null, { user_id: userId });
  return c.json({ success: true, data: { user_id: userId } });
});

app.get('/api/projects/:id/commits', async (c) => {
  const projectId = Number(c.req.param('id'));
  const rows = await c.env.DB.prepare(
    `SELECT pc.id AS commit_id, pc.project_id, pc.seq_no, pc.author_user_id, u.name AS author_name, u.email AS author_email,
            pc.author_system_role, pc.author_project_role, pc.title, pc.content, pc.status_from, pc.status_to,
            pc.progress_pct, pc.created_at, pc.request_id
     FROM project_commits pc
     JOIN users u ON u.id = pc.author_user_id
     WHERE pc.project_id = ?
     ORDER BY pc.seq_no DESC`,
  )
    .bind(projectId)
    .all();
  return c.json({ success: true, data: rows.results || [] });
});

app.get('/api/projects/:id/latest-status', async (c) => {
  const projectId = Number(c.req.param('id'));
  const row = await c.env.DB.prepare(
    `SELECT p.status AS current_status,
            (SELECT status_to FROM project_commits WHERE project_id = p.id ORDER BY seq_no DESC LIMIT 1) AS latest_commit_status,
            (SELECT created_at FROM project_commits WHERE project_id = p.id ORDER BY seq_no DESC LIMIT 1) AS latest_commit_at
     FROM projects p
     WHERE p.id = ?`,
  )
    .bind(projectId)
    .first();
  if (!row) return apiError(c, 404, 'NOT_FOUND', 'Project not found');
  return c.json({ success: true, data: row });
});

app.post('/api/projects/:id/commits', async (c) => {
  const projectId = Number(c.req.param('id'));
  const user = c.get('authUser');

  const project = await c.env.DB.prepare('SELECT id, status FROM projects WHERE id = ?').bind(projectId).first<{ id: number; status: string }>();
  if (!project) return apiError(c, 404, 'NOT_FOUND', 'Project not found');

  const member = await c.env.DB.prepare('SELECT project_role FROM project_members WHERE project_id = ? AND user_id = ?')
    .bind(projectId, user.id)
    .first<{ project_role: string }>();
  if (user.role !== 'admin' && !member) return apiError(c, 403, 'FORBIDDEN', 'Only project members can commit');

  const schema = z.object({
    title: z.string().min(1),
    content: z.string().min(1),
    status_to: projectStatusEnum,
    progress_pct: z.number().int().min(0).max(100).optional().nullable(),
  });
  const body = schema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return apiError(c, 400, 'INVALID_PARAMS', body.error.issues[0]?.message || 'Invalid payload');

  const authorProjectRole = member?.project_role ?? 'admin';
  let commitId = 0;
  let seqNo = 0;

  for (let i = 0; i < 3; i += 1) {
    const seq = await c.env.DB.prepare('SELECT COALESCE(MAX(seq_no), 0) + 1 AS next_seq FROM project_commits WHERE project_id = ?')
      .bind(projectId)
      .first<{ next_seq: number }>();
    seqNo = Number(seq?.next_seq || 1);

    try {
      const run = await c.env.DB.prepare(
        `INSERT INTO project_commits
          (project_id, seq_no, author_user_id, author_system_role, author_project_role, title, content, status_from, status_to, progress_pct, created_at, request_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          projectId,
          seqNo,
          user.id,
          user.role,
          authorProjectRole,
          body.data.title,
          body.data.content,
          project.status,
          body.data.status_to,
          body.data.progress_pct ?? null,
          now(),
          c.get('requestId'),
        )
        .run();
      commitId = Number(run.meta.last_row_id);
      break;
    } catch (error) {
      if (!String(error).includes('UNIQUE') || i === 2) throw error;
    }
  }

  await c.env.DB.prepare('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?').bind(body.data.status_to, now(), projectId).run();
  await writeAudit(c, 'project_commit.create', 'project', String(projectId), null, {
    commit_id: commitId,
    seq_no: seqNo,
    status_from: project.status,
    status_to: body.data.status_to,
  });

  return c.json({ success: true, data: { commit_id: commitId, seq_no: seqNo } }, 201);
});

app.get('/api/inventory/summary', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT p.id AS product_id, p.sku, p.name, p.unit, p.safety_stock_qty,
            COALESCE(b.on_hand_qty, 0) AS on_hand_qty,
            COALESCE(b.in_transit_qty, 0) AS in_transit_qty,
            COALESCE(b.reserved_qty, 0) AS reserved_qty,
            COALESCE(b.consumed_qty, 0) AS consumed_qty
     FROM products p
     LEFT JOIN inventory_balances b ON b.product_id = p.id
     ORDER BY p.id DESC`,
  ).all();
  return c.json({ success: true, data: (rows.results || []).map(mapInventoryLike) });
});

app.get('/api/inventory/transactions', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT it.id, it.product_id, p.sku, p.name AS product_name, it.operation_type, it.qty, it.delta_on_hand, it.delta_in_transit,
            it.delta_reserved, it.delta_consumed, it.project_id, it.reservation_id, it.reason, it.actor_user_id,
            u.name AS actor_name, it.idempotency_key, it.request_id, it.created_at
     FROM inventory_transactions it
     JOIN products p ON p.id = it.product_id
     JOIN users u ON u.id = it.actor_user_id
     ORDER BY it.id DESC
     LIMIT 500`,
  ).all();
  return c.json({ success: true, data: rows.results || [] });
});

app.get('/api/inventory/balances', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT p.id AS product_id, p.sku, p.name, p.unit, p.safety_stock_qty,
            COALESCE(b.on_hand_qty, 0) AS on_hand_qty,
            COALESCE(b.in_transit_qty, 0) AS in_transit_qty,
            COALESCE(b.reserved_qty, 0) AS reserved_qty,
            COALESCE(b.consumed_qty, 0) AS consumed_qty
     FROM products p
     LEFT JOIN inventory_balances b ON b.product_id = p.id
     ORDER BY p.id DESC`,
  ).all();
  return c.json({ success: true, data: (rows.results || []).map(mapInventoryLike) });
});

app.post('/api/inventory/inbound', async (c) => {
  const guard = requireAdmin(c);
  if (guard) return guard;
  const body = await parseInventoryBody(c, z.object({ product_id: z.number().int().positive(), qty: z.number().int().positive(), reason: z.string().optional().nullable() }));
  if (body instanceof Response) return body;
  if (!(await existsById(c.env.DB, 'products', body.product_id))) return apiError(c, 404, 'NOT_FOUND', 'Product not found');

  return withIdempotency(c, body.idempotency_key, '/inventory/inbound', async () => {
    await ensureBalanceRow(c.env.DB, body.product_id);
    await c.env.DB.prepare('UPDATE inventory_balances SET on_hand_qty = on_hand_qty + ?, updated_at = ? WHERE product_id = ?')
      .bind(body.qty, now(), body.product_id)
      .run();
    await insertInventoryTx(c, {
      product_id: body.product_id,
      operation_type: 'INBOUND',
      qty: body.qty,
      delta_on_hand: body.qty,
      delta_in_transit: 0,
      delta_reserved: 0,
      delta_consumed: 0,
      project_id: null,
      reservation_id: null,
      reason: body.reason ?? null,
      idempotency_key: body.idempotency_key,
    });
    return c.json({ success: true, data: await getInventoryByProduct(c.env.DB, body.product_id) });
  });
});

app.post('/api/inventory/outbound', async (c) => {
  const guard = requireAdmin(c);
  if (guard) return guard;
  const body = await parseInventoryBody(c, z.object({ product_id: z.number().int().positive(), qty: z.number().int().positive(), reason: z.string().optional().nullable() }));
  if (body instanceof Response) return body;
  if (!(await existsById(c.env.DB, 'products', body.product_id))) return apiError(c, 404, 'NOT_FOUND', 'Product not found');

  return withIdempotency(c, body.idempotency_key, '/inventory/outbound', async () => {
    await ensureBalanceRow(c.env.DB, body.product_id);
    const run = await c.env.DB.prepare(
      `UPDATE inventory_balances
       SET on_hand_qty = on_hand_qty - ?, updated_at = ?
       WHERE product_id = ? AND (on_hand_qty - reserved_qty) >= ?`,
    )
      .bind(body.qty, now(), body.product_id, body.qty)
      .run();
    if ((run.meta.changes ?? 0) === 0) return apiError(c, 409, 'INSUFFICIENT_AVAILABLE_STOCK', 'Not enough available stock');

    await insertInventoryTx(c, {
      product_id: body.product_id,
      operation_type: 'OUTBOUND',
      qty: body.qty,
      delta_on_hand: -body.qty,
      delta_in_transit: 0,
      delta_reserved: 0,
      delta_consumed: 0,
      project_id: null,
      reservation_id: null,
      reason: body.reason ?? null,
      idempotency_key: body.idempotency_key,
    });
    return c.json({ success: true, data: await getInventoryByProduct(c.env.DB, body.product_id) });
  });
});

app.post('/api/inventory/transit/create', async (c) => {
  const guard = requireAdmin(c);
  if (guard) return guard;
  const body = await parseInventoryBody(c, z.object({ product_id: z.number().int().positive(), qty: z.number().int().positive(), reason: z.string().optional().nullable() }));
  if (body instanceof Response) return body;
  if (!(await existsById(c.env.DB, 'products', body.product_id))) return apiError(c, 404, 'NOT_FOUND', 'Product not found');

  return withIdempotency(c, body.idempotency_key, '/inventory/transit/create', async () => {
    await ensureBalanceRow(c.env.DB, body.product_id);
    await c.env.DB.prepare('UPDATE inventory_balances SET in_transit_qty = in_transit_qty + ?, updated_at = ? WHERE product_id = ?')
      .bind(body.qty, now(), body.product_id)
      .run();
    await insertInventoryTx(c, {
      product_id: body.product_id,
      operation_type: 'TRANSIT_CREATE',
      qty: body.qty,
      delta_on_hand: 0,
      delta_in_transit: body.qty,
      delta_reserved: 0,
      delta_consumed: 0,
      project_id: null,
      reservation_id: null,
      reason: body.reason ?? null,
      idempotency_key: body.idempotency_key,
    });
    return c.json({ success: true, data: await getInventoryByProduct(c.env.DB, body.product_id) });
  });
});

app.post('/api/inventory/transit/receive', async (c) => {
  const guard = requireAdmin(c);
  if (guard) return guard;
  const body = await parseInventoryBody(c, z.object({ product_id: z.number().int().positive(), qty: z.number().int().positive(), reason: z.string().optional().nullable() }));
  if (body instanceof Response) return body;
  if (!(await existsById(c.env.DB, 'products', body.product_id))) return apiError(c, 404, 'NOT_FOUND', 'Product not found');

  return withIdempotency(c, body.idempotency_key, '/inventory/transit/receive', async () => {
    await ensureBalanceRow(c.env.DB, body.product_id);
    const run = await c.env.DB.prepare(
      `UPDATE inventory_balances
       SET in_transit_qty = in_transit_qty - ?, on_hand_qty = on_hand_qty + ?, updated_at = ?
       WHERE product_id = ? AND in_transit_qty >= ?`,
    )
      .bind(body.qty, body.qty, now(), body.product_id, body.qty)
      .run();
    if ((run.meta.changes ?? 0) === 0) return apiError(c, 409, 'INSUFFICIENT_TRANSIT_STOCK', 'Not enough in-transit stock');

    await insertInventoryTx(c, {
      product_id: body.product_id,
      operation_type: 'TRANSIT_RECEIVE',
      qty: body.qty,
      delta_on_hand: body.qty,
      delta_in_transit: -body.qty,
      delta_reserved: 0,
      delta_consumed: 0,
      project_id: null,
      reservation_id: null,
      reason: body.reason ?? null,
      idempotency_key: body.idempotency_key,
    });
    return c.json({ success: true, data: await getInventoryByProduct(c.env.DB, body.product_id) });
  });
});
app.post('/api/inventory/reserve', async (c) => {
  const guard = requireAdmin(c);
  if (guard) return guard;
  const schema = z.object({
    project_id: z.number().int().positive(),
    product_id: z.number().int().positive(),
    qty: z.number().int().positive(),
    reason: z.string().optional().nullable(),
  });
  const body = await parseInventoryBody(c, schema);
  if (body instanceof Response) return body;

  const project = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(body.project_id).first();
  if (!project) return apiError(c, 404, 'NOT_FOUND', 'Project not found');
  if (!(await existsById(c.env.DB, 'products', body.product_id))) return apiError(c, 404, 'NOT_FOUND', 'Product not found');

  return withIdempotency(c, body.idempotency_key, '/inventory/reserve', async () => {
    await ensureBalanceRow(c.env.DB, body.product_id);
    const run = await c.env.DB.prepare(
      `UPDATE inventory_balances
       SET reserved_qty = reserved_qty + ?, updated_at = ?
       WHERE product_id = ? AND (on_hand_qty - reserved_qty) >= ?`,
    )
      .bind(body.qty, now(), body.product_id, body.qty)
      .run();
    if ((run.meta.changes ?? 0) === 0) return apiError(c, 409, 'INSUFFICIENT_AVAILABLE_STOCK', 'Not enough available stock');

    const reservation = await c.env.DB.prepare(
      `INSERT INTO project_reservations (project_id, product_id, qty, consumed_qty, released_qty, status, created_at, updated_at)
       VALUES (?, ?, ?, 0, 0, 'active', ?, ?)`,
    )
      .bind(body.project_id, body.product_id, body.qty, now(), now())
      .run();
    const reservationId = Number(reservation.meta.last_row_id);

    await insertInventoryTx(c, {
      product_id: body.product_id,
      operation_type: 'RESERVE',
      qty: body.qty,
      delta_on_hand: 0,
      delta_in_transit: 0,
      delta_reserved: body.qty,
      delta_consumed: 0,
      project_id: body.project_id,
      reservation_id: reservationId,
      reason: body.reason ?? null,
      idempotency_key: body.idempotency_key,
    });

    return c.json({
      success: true,
      data: {
        reservation_id: reservationId,
        inventory: await getInventoryByProduct(c.env.DB, body.product_id),
      },
    });
  });
});

app.post('/api/inventory/release', async (c) => {
  const guard = requireAdmin(c);
  if (guard) return guard;
  const schema = z.object({ reservation_id: z.number().int().positive(), qty: z.number().int().positive(), reason: z.string().optional().nullable() });
  const body = await parseInventoryBody(c, schema);
  if (body instanceof Response) return body;

  return withIdempotency(c, body.idempotency_key, '/inventory/release', async () => {
    const reservation = await c.env.DB.prepare('SELECT * FROM project_reservations WHERE id = ?')
      .bind(body.reservation_id)
      .first<{ id: number; project_id: number; product_id: number; qty: number; consumed_qty: number; released_qty: number }>();
    if (!reservation) return apiError(c, 404, 'NOT_FOUND', 'Reservation not found');

    const remaining = reservation.qty - reservation.consumed_qty - reservation.released_qty;
    if (remaining < body.qty) return apiError(c, 409, 'INVALID_RELEASE_QTY', 'Release exceeds remaining reservation');

    const run = await c.env.DB.prepare(
      `UPDATE inventory_balances
       SET reserved_qty = reserved_qty - ?, updated_at = ?
       WHERE product_id = ? AND reserved_qty >= ?`,
    )
      .bind(body.qty, now(), reservation.product_id, body.qty)
      .run();
    if ((run.meta.changes ?? 0) === 0) return apiError(c, 409, 'INSUFFICIENT_RESERVED_STOCK', 'Not enough reserved stock');

    const nextReleased = reservation.released_qty + body.qty;
    const closed = reservation.consumed_qty + nextReleased >= reservation.qty;
    await c.env.DB.prepare('UPDATE project_reservations SET released_qty = ?, status = ?, updated_at = ? WHERE id = ?')
      .bind(nextReleased, closed ? 'closed' : 'active', now(), reservation.id)
      .run();

    await insertInventoryTx(c, {
      product_id: reservation.product_id,
      operation_type: 'RELEASE',
      qty: body.qty,
      delta_on_hand: 0,
      delta_in_transit: 0,
      delta_reserved: -body.qty,
      delta_consumed: 0,
      project_id: reservation.project_id,
      reservation_id: reservation.id,
      reason: body.reason ?? null,
      idempotency_key: body.idempotency_key,
    });

    return c.json({
      success: true,
      data: {
        reservation_id: reservation.id,
        inventory: await getInventoryByProduct(c.env.DB, reservation.product_id),
      },
    });
  });
});

app.post('/api/inventory/consume', async (c) => {
  const guard = requireAdmin(c);
  if (guard) return guard;
  const schema = z.object({ reservation_id: z.number().int().positive(), qty: z.number().int().positive(), note: z.string().optional().nullable() });
  const body = await parseInventoryBody(c, schema);
  if (body instanceof Response) return body;

  return withIdempotency(c, body.idempotency_key, '/inventory/consume', async () => {
    const reservation = await c.env.DB.prepare('SELECT * FROM project_reservations WHERE id = ?')
      .bind(body.reservation_id)
      .first<{ id: number; project_id: number; product_id: number; qty: number; consumed_qty: number; released_qty: number }>();
    if (!reservation) return apiError(c, 404, 'NOT_FOUND', 'Reservation not found');

    const remaining = reservation.qty - reservation.consumed_qty - reservation.released_qty;
    if (remaining < body.qty) return apiError(c, 409, 'INVALID_CONSUME_QTY', 'Consume exceeds remaining reservation');

    const run = await c.env.DB.prepare(
      `UPDATE inventory_balances
       SET reserved_qty = reserved_qty - ?, on_hand_qty = on_hand_qty - ?, consumed_qty = consumed_qty + ?, updated_at = ?
       WHERE product_id = ? AND reserved_qty >= ? AND on_hand_qty >= ?`,
    )
      .bind(body.qty, body.qty, body.qty, now(), reservation.product_id, body.qty, body.qty)
      .run();
    if ((run.meta.changes ?? 0) === 0) return apiError(c, 409, 'INSUFFICIENT_STOCK', 'Not enough stock to consume');

    const nextConsumed = reservation.consumed_qty + body.qty;
    const closed = nextConsumed + reservation.released_qty >= reservation.qty;
    await c.env.DB.prepare('UPDATE project_reservations SET consumed_qty = ?, status = ?, updated_at = ? WHERE id = ?')
      .bind(nextConsumed, closed ? 'closed' : 'active', now(), reservation.id)
      .run();

    await c.env.DB.prepare(
      'INSERT INTO project_consumptions (reservation_id, project_id, product_id, qty, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(reservation.id, reservation.project_id, reservation.product_id, body.qty, body.note ?? null, now())
      .run();

    await insertInventoryTx(c, {
      product_id: reservation.product_id,
      operation_type: 'CONSUME',
      qty: body.qty,
      delta_on_hand: -body.qty,
      delta_in_transit: 0,
      delta_reserved: -body.qty,
      delta_consumed: body.qty,
      project_id: reservation.project_id,
      reservation_id: reservation.id,
      reason: body.note ?? null,
      idempotency_key: body.idempotency_key,
    });

    return c.json({
      success: true,
      data: {
        reservation_id: reservation.id,
        inventory: await getInventoryByProduct(c.env.DB, reservation.product_id),
      },
    });
  });
});

app.post('/api/inventory/adjust', async (c) => {
  const guard = requireAdmin(c);
  if (guard) return guard;
  const schema = z.object({
    product_id: z.number().int().positive(),
    delta_qty: z.number().int().refine((v) => v !== 0, 'delta_qty cannot be zero'),
    reason: z.string().min(1),
  });
  const body = await parseInventoryBody(c, schema);
  if (body instanceof Response) return body;
  if (!(await existsById(c.env.DB, 'products', body.product_id))) return apiError(c, 404, 'NOT_FOUND', 'Product not found');

  return withIdempotency(c, body.idempotency_key, '/inventory/adjust', async () => {
    const run = await c.env.DB.prepare(
      `UPDATE inventory_balances
       SET on_hand_qty = on_hand_qty + ?, updated_at = ?
       WHERE product_id = ?
         AND (on_hand_qty + ?) >= 0
         AND ((on_hand_qty + ?) - reserved_qty) >= 0`,
    )
      .bind(body.delta_qty, now(), body.product_id, body.delta_qty, body.delta_qty)
      .run();
    if ((run.meta.changes ?? 0) === 0) return apiError(c, 409, 'INVALID_ADJUSTMENT', 'Adjustment violates stock constraints');

    await insertInventoryTx(c, {
      product_id: body.product_id,
      operation_type: 'ADJUST',
      qty: Math.abs(body.delta_qty),
      delta_on_hand: body.delta_qty,
      delta_in_transit: 0,
      delta_reserved: 0,
      delta_consumed: 0,
      project_id: null,
      reservation_id: null,
      reason: body.reason,
      idempotency_key: body.idempotency_key,
    });

    return c.json({ success: true, data: await getInventoryByProduct(c.env.DB, body.product_id) });
  });
});

app.get('/api/reports/inventory-overview', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT p.id AS product_id, p.sku, p.name, p.unit, p.safety_stock_qty,
            COALESCE(b.on_hand_qty, 0) AS on_hand_qty,
            COALESCE(b.in_transit_qty, 0) AS in_transit_qty,
            COALESCE(b.reserved_qty, 0) AS reserved_qty,
            COALESCE(b.consumed_qty, 0) AS consumed_qty
     FROM products p
     LEFT JOIN inventory_balances b ON b.product_id = p.id
     ORDER BY p.id DESC`,
  ).all();
  return c.json({ success: true, data: (rows.results || []).map(mapInventoryLike) });
});

app.get('/api/reports/inventory-ledger', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT it.id, it.product_id, p.sku, p.name AS product_name, it.operation_type, it.qty, it.delta_on_hand, it.delta_in_transit,
            it.delta_reserved, it.delta_consumed, it.project_id, it.reservation_id, it.reason, it.actor_user_id,
            u.name AS actor_name, it.idempotency_key, it.request_id, it.created_at
     FROM inventory_transactions it
     JOIN products p ON p.id = it.product_id
     JOIN users u ON u.id = it.actor_user_id
     ORDER BY it.id DESC
     LIMIT 500`,
  ).all();
  return c.json({ success: true, data: rows.results || [] });
});

app.get('/api/reports/project-material-usage', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT p.project_code, p.project_name, pr.product_id, pd.sku, pd.name AS product_name,
            COALESCE(pl.planned_qty, 0) AS planned_qty,
            COALESCE(SUM(pr.qty), 0) AS reserved_qty,
            COALESCE(SUM(pc.qty), 0) AS consumed_qty,
            COALESCE(SUM(pr.qty), 0) - COALESCE(SUM(pc.qty), 0) AS remaining_reserved_qty
     FROM project_reservations pr
     JOIN projects p ON p.id = pr.project_id
     JOIN products pd ON pd.id = pr.product_id
     LEFT JOIN project_material_plans pl ON pl.project_id = pr.project_id AND pl.product_id = pr.product_id
     LEFT JOIN project_consumptions pc ON pc.reservation_id = pr.id
     GROUP BY p.project_code, p.project_name, pr.product_id, pd.sku, pd.name, pl.planned_qty
     ORDER BY p.project_code, pd.sku`,
  ).all();
  return c.json({ success: true, data: rows.results || [] });
});

app.get('/api/reports/project-commit-history', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT p.project_code, p.project_name, pc.seq_no, pc.title, pc.status_from, pc.status_to, pc.progress_pct, pc.created_at,
            u.name AS author_name, pc.author_system_role, pc.author_project_role
     FROM project_commits pc
     JOIN projects p ON p.id = pc.project_id
     JOIN users u ON u.id = pc.author_user_id
     ORDER BY pc.created_at DESC`,
  ).all();
  return c.json({ success: true, data: rows.results || [] });
});

function requireAdmin(c: any) {
  const user = c.get('authUser') as AuthUser;
  if (user.role !== 'admin') return apiError(c, 403, 'FORBIDDEN', 'Admin permission required');
  return null;
}

async function parseInventoryBody<T extends z.ZodRawShape>(c: any, schema: z.ZodObject<T>) {
  const merged = schema.extend({ idempotency_key: z.string().min(8) });
  const body = merged.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return apiError(c, 400, 'INVALID_PARAMS', body.error.issues[0]?.message || 'Invalid payload');
  return body.data;
}

async function withIdempotency(c: any, idempotencyKey: string, endpoint: string, fn: () => Promise<Response>) {
  const user = c.get('authUser') as AuthUser;
  try {
    await c.env.DB.prepare('INSERT INTO idempotency_keys (key, endpoint, user_id, created_at) VALUES (?, ?, ?, ?)')
      .bind(idempotencyKey, endpoint, user.id, now())
      .run();
  } catch (error) {
    if (String(error).includes('UNIQUE')) return apiError(c, 409, 'IDEMPOTENCY_CONFLICT', 'Duplicate idempotency key');
    throw error;
  }
  return fn();
}

async function insertInventoryTx(
  c: any,
  tx: {
    product_id: number;
    operation_type: string;
    qty: number;
    delta_on_hand: number;
    delta_in_transit: number;
    delta_reserved: number;
    delta_consumed: number;
    project_id: number | null;
    reservation_id: number | null;
    reason: string | null;
    idempotency_key: string;
  },
) {
  const user = c.get('authUser') as AuthUser;
  await c.env.DB.prepare(
    `INSERT INTO inventory_transactions
      (product_id, operation_type, qty, delta_on_hand, delta_in_transit, delta_reserved, delta_consumed, project_id, reservation_id, reason, actor_user_id, idempotency_key, request_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      tx.product_id,
      tx.operation_type,
      tx.qty,
      tx.delta_on_hand,
      tx.delta_in_transit,
      tx.delta_reserved,
      tx.delta_consumed,
      tx.project_id,
      tx.reservation_id,
      tx.reason,
      user.id,
      tx.idempotency_key,
      c.get('requestId'),
      now(),
    )
    .run();
}

async function writeAudit(c: any, action: string, targetType: string, targetId: string, beforeJson: unknown, afterJson: unknown) {
  const user = c.get('authUser') as AuthUser | undefined;
  if (!user) return;
  await c.env.DB.prepare(
    `INSERT INTO audit_logs
      (actor_user_id, action, target_type, target_id, before_json, after_json, request_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(user.id, action, targetType, targetId, beforeJson ? JSON.stringify(beforeJson) : null, afterJson ? JSON.stringify(afterJson) : null, c.get('requestId'), now())
    .run();
}

async function ensureBalanceRow(db: D1Database, productId: number) {
  await db.prepare(
    'INSERT INTO inventory_balances (product_id, on_hand_qty, in_transit_qty, reserved_qty, consumed_qty, updated_at) VALUES (?, 0, 0, 0, 0, ?) ON CONFLICT(product_id) DO NOTHING',
  )
    .bind(productId, now())
    .run();
}

async function existsById(db: D1Database, table: string, id: number) {
  const safeTable = table.replace(/[^a-z_]/g, '');
  const row = await db.prepare(`SELECT id FROM ${safeTable} WHERE id = ?`).bind(id).first();
  return !!row;
}

async function getInventoryByProduct(db: D1Database, productId: number) {
  const row = await db.prepare(
    `SELECT p.id AS product_id, p.sku, p.name, p.unit, p.safety_stock_qty,
            COALESCE(b.on_hand_qty, 0) AS on_hand_qty,
            COALESCE(b.in_transit_qty, 0) AS in_transit_qty,
            COALESCE(b.reserved_qty, 0) AS reserved_qty,
            COALESCE(b.consumed_qty, 0) AS consumed_qty
     FROM products p
     LEFT JOIN inventory_balances b ON b.product_id = p.id
     WHERE p.id = ?`,
  )
    .bind(productId)
    .first<Record<string, unknown>>();
  return row ? mapInventoryLike(row) : null;
}

function mapInventoryLike(row: Record<string, unknown>) {
  const onHand = Number(row.on_hand_qty || 0);
  const inTransit = Number(row.in_transit_qty || 0);
  const reserved = Number(row.reserved_qty || 0);
  const consumed = Number(row.consumed_qty || 0);
  const safety = Number(row.safety_stock_qty || 0);
  const available = onHand - reserved;
  return {
    ...row,
    on_hand_qty: onHand,
    in_transit_qty: inTransit,
    reserved_qty: reserved,
    consumed_qty: consumed,
    total_stock_qty: onHand + inTransit,
    available_qty: available,
    shortage_qty: Math.max(0, safety - available),
  };
}

function now() {
  return new Date().toISOString();
}

async function sha256(input: string) {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function apiError(c: any, status: number, errorCode: string, message: string) {
  return c.json(
    {
      success: false,
      error_code: errorCode,
      message,
      request_id: c.get('requestId'),
    },
    status,
  );
}

export default app;
