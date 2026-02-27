import { FormEvent, useEffect, useMemo, useState } from 'react';
import { apiClient } from './api';
import type {
  Category,
  InventoryItem,
  Product,
  Project,
  ProjectCommit,
  ProjectMember,
  ProjectReservation,
  User,
} from './types';

type Tab = 'dashboard' | 'master' | 'inventory' | 'projects' | 'users';
type NumInput = '' | number;

function toNum(value: NumInput) {
  return typeof value === 'number' ? value : Number(value);
}

export function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('am_token'));
  const [me, setMe] = useState<User | null>(null);
  const [tab, setTab] = useState<Tab>('dashboard');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [users, setUsers] = useState<User[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);

  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [commits, setCommits] = useState<ProjectCommit[]>([]);
  const [reservations, setReservations] = useState<ProjectReservation[]>([]);

  const [loginForm, setLoginForm] = useState({ email: 'admin@example.com', password: 'admin123' });
  const [categoryName, setCategoryName] = useState('');
  const [skuForm, setSkuForm] = useState({
    sku: '',
    name: '',
    categoryId: '' as NumInput,
    unit: 'pcs',
    spec: '',
    safetyStock: 0,
  });
  const [projectForm, setProjectForm] = useState({
    code: '',
    name: '',
    ownerId: '' as NumInput,
    note: '',
  });
  const [memberForm, setMemberForm] = useState({ userId: '' as NumInput, projectRole: 'Developer' });
  const [commitForm, setCommitForm] = useState({
    title: '',
    content: '',
    statusTo: 'active' as const,
    progress: 0,
  });
  const [userForm, setUserForm] = useState<{ email: string; name: string; password: string; role: 'admin' | 'visitor' }>({
    email: '',
    name: '',
    password: '',
    role: 'visitor',
  });

  const [inboundForm, setInboundForm] = useState({ productId: '' as NumInput, qty: '' as NumInput, reason: '' });
  const [transitCreateForm, setTransitCreateForm] = useState({ productId: '' as NumInput, qty: '' as NumInput, reason: '' });
  const [transitReceiveForm, setTransitReceiveForm] = useState({ productId: '' as NumInput, qty: '' as NumInput, reason: '' });
  const [reserveForm, setReserveForm] = useState({
    projectId: '' as NumInput,
    productId: '' as NumInput,
    qty: '' as NumInput,
    reason: '',
  });
  const [consumeForm, setConsumeForm] = useState({
    reservationId: '' as NumInput,
    qty: '' as NumInput,
    note: '',
  });

  const isAdmin = me?.role === 'admin';
  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  function setMsgError(msg: string) {
    setSuccess('');
    setError(msg);
  }

  function setMsgSuccess(msg: string) {
    setError('');
    setSuccess(msg);
  }

  async function runAction(fn: () => Promise<void>, okText: string) {
    try {
      await fn();
      setMsgSuccess(okText);
    } catch (e) {
      setMsgError((e as Error).message);
    }
  }

  async function loadBase() {
    setLoading(true);
    try {
      const [meData, categoryData, productData, projectData, inventoryData] = await Promise.all([
        apiClient.me(),
        apiClient.listCategories(),
        apiClient.listProducts(),
        apiClient.listProjects(),
        apiClient.listInventorySummary(),
      ]);
      setMe(meData);
      setCategories(categoryData);
      setProducts(productData);
      setProjects(projectData);
      setInventory(inventoryData);

      if (meData.role === 'admin') {
        setUsers(await apiClient.listUsers());
      } else {
        setUsers([]);
      }

      if (projectData.length > 0) {
        const nextProject = selectedProjectId && projectData.some((p) => p.id === selectedProjectId)
          ? selectedProjectId
          : projectData[0].id;
        setSelectedProjectId(nextProject);
      } else {
        setSelectedProjectId(null);
        setMembers([]);
        setCommits([]);
        setReservations([]);
      }
    } catch (e) {
      const msg = (e as Error).message;
      setMsgError(msg);
      if (msg.toLowerCase().includes('unauthorized') || msg.toLowerCase().includes('token')) {
        logout();
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadProjectPanel(projectId: number) {
    try {
      const [memberData, commitData, reservationData] = await Promise.all([
        apiClient.listProjectMembers(projectId),
        apiClient.listProjectCommits(projectId),
        apiClient.listProjectReservations(projectId),
      ]);
      setMembers(memberData);
      setCommits(commitData);
      setReservations(reservationData);
    } catch (e) {
      setMsgError((e as Error).message);
    }
  }

  useEffect(() => {
    if (!token) return;
    apiClient.setToken(token);
    void loadBase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!token || !selectedProjectId) return;
    void loadProjectPanel(selectedProjectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId, token]);

  function logout() {
    localStorage.removeItem('am_token');
    apiClient.setToken(null);
    setToken(null);
    setMe(null);
    setUsers([]);
    setCategories([]);
    setProducts([]);
    setProjects([]);
    setInventory([]);
    setMembers([]);
    setCommits([]);
    setReservations([]);
    setError('');
    setSuccess('');
  }

  if (!token) {
    return (
      <div className="auth-wrap">
        <form
          className="auth-panel"
          onSubmit={(e) => {
            e.preventDefault();
            void runAction(async () => {
              const resp = await apiClient.login(loginForm.email.trim(), loginForm.password);
              localStorage.setItem('am_token', resp.token);
              apiClient.setToken(resp.token);
              setToken(resp.token);
            }, 'Login success');
          }}
        >
          <h1>AM Manager ERP</h1>
          <p>Default admin: admin@example.com / admin123</p>
          <label>
            Email
            <input value={loginForm.email} onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })} />
          </label>
          <label>
            Password
            <input type="password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} />
          </label>
          <button type="submit" disabled={loading}>Login</button>
          {error && <div className="msg error">{error}</div>}
        </form>
      </div>
    );
  }

  return (
    <div className="layout">
      <aside className="nav">
        <h2>AM ERP</h2>
        <p>{me?.name} ({me?.role})</p>
        <button className={tab === 'dashboard' ? 'active' : ''} onClick={() => setTab('dashboard')}>Dashboard</button>
        <button className={tab === 'master' ? 'active' : ''} onClick={() => setTab('master')}>Master Data</button>
        <button className={tab === 'inventory' ? 'active' : ''} onClick={() => setTab('inventory')}>Inventory</button>
        <button className={tab === 'projects' ? 'active' : ''} onClick={() => setTab('projects')}>Projects</button>
        {isAdmin && <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>Users</button>}
        <button className="ghost" disabled={loading} onClick={() => void loadBase()}>Refresh</button>
        <button className="logout" onClick={logout}>Logout</button>
      </aside>

      <main className="content">
        {error && <div className="msg error">{error}</div>}
        {success && <div className="msg ok">{success}</div>}

        {tab === 'dashboard' && (
          <section className="panel">
            <h3>Inventory KPI</h3>
            <div className="metrics">
              <div><span>SKUs</span><strong>{inventory.length}</strong></div>
              <div><span>Total</span><strong>{inventory.reduce((a, b) => a + b.total_stock_qty, 0)}</strong></div>
              <div><span>On Hand</span><strong>{inventory.reduce((a, b) => a + b.on_hand_qty, 0)}</strong></div>
              <div><span>In Transit</span><strong>{inventory.reduce((a, b) => a + b.in_transit_qty, 0)}</strong></div>
              <div><span>Available</span><strong>{inventory.reduce((a, b) => a + b.available_qty, 0)}</strong></div>
              <div><span>Reserved</span><strong>{inventory.reduce((a, b) => a + b.reserved_qty, 0)}</strong></div>
              <div><span>Consumed</span><strong>{inventory.reduce((a, b) => a + b.consumed_qty, 0)}</strong></div>
              <div><span>Shortage</span><strong>{inventory.reduce((a, b) => a + b.shortage_qty, 0)}</strong></div>
            </div>
          </section>
        )}

        {tab === 'master' && (
          <>
            <section className="panel">
              <h3>Create Product SKU</h3>
              {isAdmin && (
                <div className="grid2">
                  <form className="form" onSubmit={(e) => {
                    e.preventDefault();
                    if (!categoryName.trim()) return setMsgError('Category name is required');
                    void runAction(async () => {
                      await apiClient.createCategory({ name: categoryName.trim() });
                      setCategoryName('');
                      await loadBase();
                    }, 'Category created');
                  }}>
                    <h4>New Category</h4>
                    <input placeholder="Category name" value={categoryName} onChange={(e) => setCategoryName(e.target.value)} />
                    <button type="submit">Create Category</button>
                  </form>

                  <form className="form" onSubmit={(e) => {
                    e.preventDefault();
                    if (!skuForm.sku.trim() || !skuForm.name.trim()) return setMsgError('SKU and Name are required');
                    if (!toNum(skuForm.categoryId)) return setMsgError('Category is required');
                    void runAction(async () => {
                      await apiClient.createProduct({
                        sku: skuForm.sku.trim(),
                        name: skuForm.name.trim(),
                        category_id: toNum(skuForm.categoryId),
                        unit: skuForm.unit.trim() || 'pcs',
                        spec: skuForm.spec.trim(),
                        safety_stock_qty: Number(skuForm.safetyStock),
                        status: 'active',
                      });
                      setSkuForm({ sku: '', name: '', categoryId: '', unit: 'pcs', spec: '', safetyStock: 0 });
                      await loadBase();
                    }, 'SKU created');
                  }}>
                    <h4>New SKU</h4>
                    <input placeholder="SKU code" value={skuForm.sku} onChange={(e) => setSkuForm({ ...skuForm, sku: e.target.value })} />
                    <input placeholder="Product name" value={skuForm.name} onChange={(e) => setSkuForm({ ...skuForm, name: e.target.value })} />
                    <select value={skuForm.categoryId} onChange={(e) => setSkuForm({ ...skuForm, categoryId: e.target.value ? Number(e.target.value) : '' })}>
                      <option value="">Select category</option>
                      {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <div className="row2">
                      <input placeholder="Unit" value={skuForm.unit} onChange={(e) => setSkuForm({ ...skuForm, unit: e.target.value })} />
                      <input type="number" placeholder="Safety stock" value={skuForm.safetyStock} onChange={(e) => setSkuForm({ ...skuForm, safetyStock: Number(e.target.value) })} />
                    </div>
                    <input placeholder="Spec" value={skuForm.spec} onChange={(e) => setSkuForm({ ...skuForm, spec: e.target.value })} />
                    <button type="submit">Create SKU</button>
                  </form>
                </div>
              )}

              <div className="table-wrap">
                <table>
                  <thead><tr><th>SKU</th><th>Name</th><th>Category</th><th>Unit</th><th>Total</th><th>Available</th><th>Reserved</th><th>Consumed</th></tr></thead>
                  <tbody>{products.map((p) => <tr key={p.id}><td>{p.sku}</td><td>{p.name}</td><td>{p.category_name}</td><td>{p.unit}</td><td>{p.total_stock_qty}</td><td>{p.available_qty}</td><td>{p.reserved_qty}</td><td>{p.consumed_qty}</td></tr>)}</tbody>
                </table>
              </div>
            </section>

            <section className="panel">
              <h3>Create Project</h3>
              {isAdmin && (
                <form className="form" onSubmit={(e) => {
                  e.preventDefault();
                  if (!projectForm.code.trim() || !projectForm.name.trim()) return setMsgError('Project code and name are required');
                  if (!toNum(projectForm.ownerId)) return setMsgError('Owner is required');
                  void runAction(async () => {
                    await apiClient.createProject({
                      project_code: projectForm.code.trim(),
                      project_name: projectForm.name.trim(),
                      owner_user_id: toNum(projectForm.ownerId),
                      status: 'planned',
                      note: projectForm.note.trim(),
                    });
                    setProjectForm({ code: '', name: '', ownerId: '', note: '' });
                    await loadBase();
                  }, 'Project created');
                }}>
                  <div className="row2">
                    <input placeholder="Project code" value={projectForm.code} onChange={(e) => setProjectForm({ ...projectForm, code: e.target.value })} />
                    <input placeholder="Project name" value={projectForm.name} onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })} />
                  </div>
                  <select value={projectForm.ownerId} onChange={(e) => setProjectForm({ ...projectForm, ownerId: e.target.value ? Number(e.target.value) : '' })}>
                    <option value="">Select owner</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                  <input placeholder="Note" value={projectForm.note} onChange={(e) => setProjectForm({ ...projectForm, note: e.target.value })} />
                  <button type="submit">Create Project</button>
                </form>
              )}
            </section>
          </>
        )}

        {tab === 'inventory' && (
          <>
            <section className="panel">
              <h3>Add Inventory</h3>
              {isAdmin ? (
                <div className="grid3">
                  <InventoryForm title="Inbound" products={products} state={inboundForm} setState={setInboundForm} onSubmit={(e) => {
                    e.preventDefault();
                    if (!toNum(inboundForm.productId) || !toNum(inboundForm.qty)) return setMsgError('Product and quantity required');
                    void runAction(async () => {
                      await apiClient.inbound({ product_id: toNum(inboundForm.productId), qty: toNum(inboundForm.qty), reason: inboundForm.reason.trim() });
                      setInboundForm({ productId: '', qty: '', reason: '' });
                      await loadBase();
                    }, 'Inbound done');
                  }} />
                  <InventoryForm title="Transit Create" products={products} state={transitCreateForm} setState={setTransitCreateForm} onSubmit={(e) => {
                    e.preventDefault();
                    if (!toNum(transitCreateForm.productId) || !toNum(transitCreateForm.qty)) return setMsgError('Product and quantity required');
                    void runAction(async () => {
                      await apiClient.transitCreate({ product_id: toNum(transitCreateForm.productId), qty: toNum(transitCreateForm.qty), reason: transitCreateForm.reason.trim() });
                      setTransitCreateForm({ productId: '', qty: '', reason: '' });
                      await loadBase();
                    }, 'Transit added');
                  }} />
                  <InventoryForm title="Transit Receive" products={products} state={transitReceiveForm} setState={setTransitReceiveForm} onSubmit={(e) => {
                    e.preventDefault();
                    if (!toNum(transitReceiveForm.productId) || !toNum(transitReceiveForm.qty)) return setMsgError('Product and quantity required');
                    void runAction(async () => {
                      await apiClient.transitReceive({ product_id: toNum(transitReceiveForm.productId), qty: toNum(transitReceiveForm.qty), reason: transitReceiveForm.reason.trim() });
                      setTransitReceiveForm({ productId: '', qty: '', reason: '' });
                      await loadBase();
                    }, 'Transit received');
                  }} />
                </div>
              ) : <p>Visitor is read-only for inventory.</p>}
            </section>

            <section className="panel">
              <h3>Reserve then Consume</h3>
              {isAdmin ? (
                <div className="grid2">
                  <form className="form" onSubmit={(e) => {
                    e.preventDefault();
                    if (!toNum(reserveForm.projectId) || !toNum(reserveForm.productId) || !toNum(reserveForm.qty)) return setMsgError('Project, product and quantity required');
                    void runAction(async () => {
                      await apiClient.reserve({
                        project_id: toNum(reserveForm.projectId),
                        product_id: toNum(reserveForm.productId),
                        qty: toNum(reserveForm.qty),
                        reason: reserveForm.reason.trim(),
                      });
                      setReserveForm({ projectId: '', productId: '', qty: '', reason: '' });
                      await loadBase();
                      if (selectedProjectId) await loadProjectPanel(selectedProjectId);
                    }, 'Reserve done');
                  }}>
                    <h4>Reserve</h4>
                    <select value={reserveForm.projectId} onChange={(e) => setReserveForm({ ...reserveForm, projectId: e.target.value ? Number(e.target.value) : '' })}>
                      <option value="">Select project</option>
                      {projects.map((p) => <option key={p.id} value={p.id}>{p.project_code}</option>)}
                    </select>
                    <select value={reserveForm.productId} onChange={(e) => setReserveForm({ ...reserveForm, productId: e.target.value ? Number(e.target.value) : '' })}>
                      <option value="">Select product</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.sku} - {p.name}</option>)}
                    </select>
                    <input type="number" placeholder="Qty" value={reserveForm.qty} onChange={(e) => setReserveForm({ ...reserveForm, qty: e.target.value ? Number(e.target.value) : '' })} />
                    <input placeholder="Reason" value={reserveForm.reason} onChange={(e) => setReserveForm({ ...reserveForm, reason: e.target.value })} />
                    <button type="submit">Submit Reserve</button>
                  </form>

                  <form className="form" onSubmit={(e) => {
                    e.preventDefault();
                    if (!toNum(consumeForm.reservationId) || !toNum(consumeForm.qty)) return setMsgError('Reservation and quantity required');
                    void runAction(async () => {
                      await apiClient.consume({ reservation_id: toNum(consumeForm.reservationId), qty: toNum(consumeForm.qty), note: consumeForm.note.trim() });
                      setConsumeForm({ reservationId: '', qty: '', note: '' });
                      await loadBase();
                      if (selectedProjectId) await loadProjectPanel(selectedProjectId);
                    }, 'Consume done');
                  }}>
                    <h4>Consume</h4>
                    <select value={consumeForm.reservationId} onChange={(e) => setConsumeForm({ ...consumeForm, reservationId: e.target.value ? Number(e.target.value) : '' })}>
                      <option value="">Select reservation</option>
                      {reservations.filter((r) => r.remaining_qty > 0).map((r) => (
                        <option key={r.reservation_id} value={r.reservation_id}>#{r.reservation_id} {r.sku} remain:{r.remaining_qty}</option>
                      ))}
                    </select>
                    <input type="number" placeholder="Qty" value={consumeForm.qty} onChange={(e) => setConsumeForm({ ...consumeForm, qty: e.target.value ? Number(e.target.value) : '' })} />
                    <input placeholder="Note" value={consumeForm.note} onChange={(e) => setConsumeForm({ ...consumeForm, note: e.target.value })} />
                    <button type="submit">Submit Consume</button>
                  </form>
                </div>
              ) : <p>Visitor is read-only for inventory.</p>}
            </section>
          </>
        )}

        {tab === 'projects' && (
          <section className="panel">
            <h3>Project Collaboration</h3>
            <div className="project-layout">
              <div>
                <h4>Project List</h4>
                <div className="list-panel">
                  {projects.map((p) => (
                    <button key={p.id} className={selectedProjectId === p.id ? 'project-btn active' : 'project-btn'} onClick={() => setSelectedProjectId(p.id)}>
                      <strong>{p.project_code}</strong>
                      <span>{p.project_name}</span>
                      <em>{p.status}</em>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <h4>{selectedProject ? `${selectedProject.project_code} - ${selectedProject.project_name}` : 'Select project'}</h4>
                {selectedProject && (
                  <>
                    {isAdmin && (
                      <form className="form" onSubmit={(e) => {
                        e.preventDefault();
                        if (!toNum(memberForm.userId)) return setMsgError('User required');
                        if (!memberForm.projectRole.trim()) return setMsgError('Project role required');
                        void runAction(async () => {
                          await apiClient.addProjectMember(selectedProject.id, { user_id: toNum(memberForm.userId), project_role: memberForm.projectRole.trim() });
                          setMemberForm({ userId: '', projectRole: 'Developer' });
                          await loadProjectPanel(selectedProject.id);
                        }, 'Member added');
                      }}>
                        <h5>Add Project Member</h5>
                        <div className="row2">
                          <select value={memberForm.userId} onChange={(e) => setMemberForm({ ...memberForm, userId: e.target.value ? Number(e.target.value) : '' })}>
                            <option value="">Select user</option>
                            {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
                          </select>
                          <input placeholder="Project role" value={memberForm.projectRole} onChange={(e) => setMemberForm({ ...memberForm, projectRole: e.target.value })} />
                        </div>
                        <button type="submit">Add Member</button>
                      </form>
                    )}

                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>Member</th><th>System Role</th><th>Project Role</th><th>Last Commit</th></tr></thead>
                        <tbody>{members.map((m) => <tr key={m.user_id}><td>{m.name}</td><td>{m.system_role}</td><td>{m.project_role}</td><td>{m.last_commit_at ? new Date(m.last_commit_at).toLocaleString() : '-'}</td></tr>)}</tbody>
                      </table>
                    </div>

                    <form className="form" onSubmit={(e) => {
                      e.preventDefault();
                      if (!commitForm.title.trim() || !commitForm.content.trim()) return setMsgError('Commit title/content required');
                      void runAction(async () => {
                        await apiClient.createProjectCommit(selectedProject.id, {
                          title: commitForm.title.trim(),
                          content: commitForm.content.trim(),
                          status_to: commitForm.statusTo,
                          progress_pct: Number(commitForm.progress),
                        });
                        setCommitForm({ title: '', content: '', statusTo: 'active', progress: 0 });
                        await loadBase();
                        await loadProjectPanel(selectedProject.id);
                      }, 'Commit submitted');
                    }}>
                      <h5>Submit Commit</h5>
                      <input placeholder="Title" value={commitForm.title} onChange={(e) => setCommitForm({ ...commitForm, title: e.target.value })} />
                      <textarea placeholder="Content" value={commitForm.content} onChange={(e) => setCommitForm({ ...commitForm, content: e.target.value })} />
                      <div className="row3">
                        <select value={commitForm.statusTo} onChange={(e) => setCommitForm({ ...commitForm, statusTo: e.target.value as typeof commitForm.statusTo })}>
                          <option value="planned">planned</option>
                          <option value="active">active</option>
                          <option value="blocked">blocked</option>
                          <option value="done">done</option>
                          <option value="cancelled">cancelled</option>
                        </select>
                        <input type="number" min={0} max={100} value={commitForm.progress} onChange={(e) => setCommitForm({ ...commitForm, progress: Number(e.target.value) })} />
                        <button type="submit">Submit Commit</button>
                      </div>
                    </form>

                    <ul className="timeline">
                      {commits.map((c) => (
                        <li key={c.commit_id}>
                          <div className="dot" />
                          <div>
                            <strong>#{c.seq_no} {c.title}</strong>
                            <p>{c.content}</p>
                            <small>{c.author_name} · {c.author_system_role}/{c.author_project_role} · {c.status_from} to {c.status_to}</small>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>
          </section>
        )}

        {tab === 'users' && isAdmin && (
          <section className="panel">
            <h3>User Management</h3>
            <form className="form" onSubmit={(e) => {
              e.preventDefault();
              if (!userForm.email.trim() || !userForm.name.trim() || !userForm.password.trim()) return setMsgError('All fields required');
              void runAction(async () => {
                await apiClient.createUser({ ...userForm, email: userForm.email.trim(), name: userForm.name.trim() });
                setUserForm({ email: '', name: '', password: '', role: 'visitor' });
                await loadBase();
              }, 'User created');
            }}>
              <div className="row3">
                <input placeholder="Email" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} />
                <input placeholder="Name" value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })} />
                <input type="password" placeholder="Password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} />
              </div>
              <div className="row2">
                <select value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value as 'admin' | 'visitor' })}>
                  <option value="visitor">visitor</option>
                  <option value="admin">admin</option>
                </select>
                <button type="submit">Create User</button>
              </div>
            </form>
            <div className="table-wrap">
              <table>
                <thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead>
                <tbody>{users.map((u) => <tr key={u.id}><td>{u.id}</td><td>{u.name}</td><td>{u.email}</td><td>{u.role}</td><td>{u.status}</td></tr>)}</tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function InventoryForm(props: {
  title: string;
  products: Product[];
  state: { productId: NumInput; qty: NumInput; reason: string };
  setState: (v: { productId: NumInput; qty: NumInput; reason: string }) => void;
  onSubmit: (e: FormEvent) => void;
}) {
  const { title, products, state, setState, onSubmit } = props;
  return (
    <form className="form" onSubmit={onSubmit}>
      <h4>{title}</h4>
      <select value={state.productId} onChange={(e) => setState({ ...state, productId: e.target.value ? Number(e.target.value) : '' })}>
        <option value="">Select product</option>
        {products.map((p) => <option key={p.id} value={p.id}>{p.sku} - {p.name}</option>)}
      </select>
      <input type="number" placeholder="Quantity" value={state.qty} onChange={(e) => setState({ ...state, qty: e.target.value ? Number(e.target.value) : '' })} />
      <input placeholder="Reason" value={state.reason} onChange={(e) => setState({ ...state, reason: e.target.value })} />
      <button type="submit">Submit</button>
    </form>
  );
}
