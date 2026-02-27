import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
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

type Tab = 'inventory' | 'projects' | 'users';
type NumInput = '' | number;
type ModalType =
  | null
  | 'category'
  | 'sku'
  | 'inbound'
  | 'transitCreate'
  | 'transitReceive'
  | 'reserve'
  | 'consume'
  | 'project'
  | 'member'
  | 'commit'
  | 'user';

const projectStatusOptions = ['planned', 'active', 'blocked', 'done', 'cancelled'] as const;

function toNum(value: NumInput) {
  return typeof value === 'number' ? value : Number(value);
}

function isPositive(value: NumInput) {
  const parsed = toNum(value);
  return Number.isFinite(parsed) && parsed > 0;
}

export function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('am_token'));
  const [modal, setModal] = useState<ModalType>(null);
  const [me, setMe] = useState<User | null>(null);
  const [tab, setTab] = useState<Tab>('inventory');
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
  const [projectReservations, setProjectReservations] = useState<ProjectReservation[]>([]);

  const [consumeProjectId, setConsumeProjectId] = useState<NumInput>('');
  const [consumeProjectReservations, setConsumeProjectReservations] = useState<ProjectReservation[]>([]);

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
    statusTo: 'active' as (typeof projectStatusOptions)[number],
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
  const [consumeForm, setConsumeForm] = useState({ reservationId: '' as NumInput, qty: '' as NumInput, note: '' });

  const isAdmin = me?.role === 'admin';
  const selectedProject = useMemo(() => projects.find((p) => p.id === selectedProjectId) ?? null, [projects, selectedProjectId]);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const inventoryRows = useMemo(
    () => [...inventory].sort((a, b) => a.sku.localeCompare(b.sku, 'en', { sensitivity: 'base' })),
    [inventory],
  );
  const productRows = useMemo(
    () => [...products].sort((a, b) => a.sku.localeCompare(b.sku, 'en', { sensitivity: 'base' })),
    [products],
  );

  function setMsg(type: 'ok' | 'error', text: string) {
    if (type === 'ok') {
      setSuccess(text);
      setError('');
    } else {
      setError(text);
      setSuccess('');
    }
  }

  async function runAction(fn: () => Promise<void>, okText: string, closeModal = true) {
    try {
      await fn();
      setMsg('ok', okText);
      if (closeModal) setModal(null);
    } catch (e) {
      setMsg('error', (e as Error).message);
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
        setProjectReservations([]);
      }
    } catch (e) {
      const msg = (e as Error).message;
      setMsg('error', msg);
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
      setProjectReservations(reservationData);
      if (toNum(consumeProjectId) === projectId) {
        setConsumeProjectReservations(reservationData);
      }
    } catch (e) {
      setMsg('error', (e as Error).message);
    }
  }

  async function loadReservationsForConsume(projectId: number) {
    try {
      const data = await apiClient.listProjectReservations(projectId);
      setConsumeProjectReservations(data);
    } catch (e) {
      setMsg('error', (e as Error).message);
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
    setSelectedProjectId(null);
    setMembers([]);
    setCommits([]);
    setProjectReservations([]);
    setConsumeProjectId('');
    setConsumeProjectReservations([]);
    setError('');
    setSuccess('');
    setModal(null);
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
            }, 'Login success', false);
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
        <button className={tab === 'inventory' ? 'active' : ''} onClick={() => setTab('inventory')}>Inventory</button>
        <button className={tab === 'projects' ? 'active' : ''} onClick={() => setTab('projects')}>Projects</button>
        {isAdmin && <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>Users</button>}
        <button className="ghost" disabled={loading} onClick={() => void loadBase()}>Refresh</button>
        <button className="logout" onClick={logout}>Logout</button>
      </aside>

      <main className="content">
        {error && <div className="msg error">{error}</div>}
        {success && <div className="msg ok">{success}</div>}

        {tab === 'inventory' && (
          <section className="panel">
            <div className="toolbar">
              <div>
                <h3>Inventory</h3>
                <p className="subtle">Stock quantities are shown only in this section.</p>
              </div>
              <div className="tools">
                {isAdmin && (
                  <>
                    <button onClick={() => setModal('category')}>New Category</button>
                    <button onClick={() => setModal('sku')}>New SKU</button>
                    <button onClick={() => setModal('inbound')}>Inbound</button>
                    <button onClick={() => setModal('transitCreate')}>Transit Create</button>
                    <button onClick={() => setModal('transitReceive')}>Transit Receive</button>
                    <button onClick={() => setModal('reserve')}>Reserve</button>
                    <button onClick={() => setModal('consume')}>Consume</button>
                  </>
                )}
              </div>
            </div>

            <h4 className="section-title">Inventory Ledger</h4>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>SKU</th>
                    <th>Name</th>
                    <th>Unit</th>
                    <th>Total</th>
                    <th>In Transit</th>
                    <th>On Hand</th>
                    <th>Available</th>
                    <th>Reserved</th>
                    <th>Consumed</th>
                    <th>Safety</th>
                    <th>Shortage</th>
                  </tr>
                </thead>
                <tbody>
                  {inventoryRows.map((row) => (
                    <tr key={row.product_id}>
                      <td>{productById.get(row.product_id)?.category_name ?? '-'}</td>
                      <td>{row.sku}</td>
                      <td>{row.name}</td>
                      <td>{row.unit}</td>
                      <td>{row.total_stock_qty}</td>
                      <td>{row.in_transit_qty}</td>
                      <td>{row.on_hand_qty}</td>
                      <td>{row.available_qty}</td>
                      <td>{row.reserved_qty}</td>
                      <td>{row.consumed_qty}</td>
                      <td>{row.safety_stock_qty}</td>
                      <td>{row.shortage_qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="split-grid">
              <section>
                <h4 className="section-title">SKU Master Data (No Stock Qty)</h4>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>SKU</th>
                        <th>Name</th>
                        <th>Category</th>
                        <th>Unit</th>
                        <th>Safety</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {productRows.map((p) => (
                        <tr key={p.id}>
                          <td>{p.sku}</td>
                          <td>{p.name}</td>
                          <td>{p.category_name}</td>
                          <td>{p.unit}</td>
                          <td>{p.safety_stock_qty}</td>
                          <td>{p.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section>
                <h4 className="section-title">Category List</h4>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Name</th>
                        <th>Parent ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categories.map((c) => (
                        <tr key={c.id}>
                          <td>{c.id}</td>
                          <td>{c.name}</td>
                          <td>{c.parent_id ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </section>
        )}

        {tab === 'projects' && (
          <section className="panel">
            <div className="toolbar">
              <div>
                <h3>Projects</h3>
                <p className="subtle">Project status and commits are managed separately from inventory.</p>
              </div>
              <div className="tools">
                {isAdmin && (
                  <>
                    <button onClick={() => setModal('project')}>New Project</button>
                    <button disabled={!selectedProject} onClick={() => setModal('member')}>Assign Member</button>
                  </>
                )}
                <button disabled={!selectedProject} onClick={() => setModal('commit')}>Submit Commit</button>
              </div>
            </div>

            <h4 className="section-title">Project List</h4>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Owner</th>
                    <th>Note</th>
                    <th>Start</th>
                    <th>End</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p) => (
                    <tr key={p.id} className={selectedProjectId === p.id ? 'row-selected' : ''} onClick={() => setSelectedProjectId(p.id)}>
                      <td>{p.project_code}</td>
                      <td>{p.project_name}</td>
                      <td>{p.status}</td>
                      <td>{p.owner_name}</td>
                      <td>{p.note || '-'}</td>
                      <td>{p.start_date || '-'}</td>
                      <td>{p.end_date || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedProject && (
              <>
                <h4 className="section-title">Selected: {selectedProject.project_code} - {selectedProject.project_name}</h4>
                <div className="split-grid">
                  <section>
                    <h5 className="minor-title">Members</h5>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>User</th>
                            <th>System Role</th>
                            <th>Project Role</th>
                            <th>Joined At</th>
                            <th>Last Commit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {members.map((m) => (
                            <tr key={m.user_id}>
                              <td>{m.name}</td>
                              <td>{m.system_role}</td>
                              <td>{m.project_role}</td>
                              <td>{m.joined_at ? new Date(m.joined_at).toLocaleString() : '-'}</td>
                              <td>{m.last_commit_at ? new Date(m.last_commit_at).toLocaleString() : '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <section>
                    <h5 className="minor-title">Reservations</h5>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>ID</th>
                            <th>SKU</th>
                            <th>Qty</th>
                            <th>Consumed</th>
                            <th>Released</th>
                            <th>Remaining</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {projectReservations.map((r) => (
                            <tr key={r.reservation_id}>
                              <td>{r.reservation_id}</td>
                              <td>{r.sku}</td>
                              <td>{r.qty}</td>
                              <td>{r.consumed_qty}</td>
                              <td>{r.released_qty}</td>
                              <td>{r.remaining_qty}</td>
                              <td>{r.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </div>

                <h4 className="section-title">Commit Timeline</h4>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Title</th>
                        <th>Author</th>
                        <th>Role</th>
                        <th>Status Flow</th>
                        <th>Progress</th>
                        <th>Time</th>
                        <th>Content</th>
                      </tr>
                    </thead>
                    <tbody>
                      {commits.map((c) => (
                        <tr key={c.commit_id}>
                          <td>{c.seq_no}</td>
                          <td>{c.title}</td>
                          <td>{c.author_name}</td>
                          <td>{c.author_system_role} / {c.author_project_role}</td>
                          <td>{c.status_from} to {c.status_to}</td>
                          <td>{typeof c.progress_pct === 'number' ? `${c.progress_pct}%` : '-'}</td>
                          <td>{new Date(c.created_at).toLocaleString()}</td>
                          <td>{c.content}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        )}

        {tab === 'users' && isAdmin && (
          <section className="panel">
            <div className="toolbar">
              <div>
                <h3>Users</h3>
                <p className="subtle">Only admin can create users.</p>
              </div>
              <div className="tools">
                <button onClick={() => setModal('user')}>New User</button>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead>
                <tbody>{users.map((u) => <tr key={u.id}><td>{u.id}</td><td>{u.name}</td><td>{u.email}</td><td>{u.role}</td><td>{u.status}</td></tr>)}</tbody>
              </table>
            </div>
          </section>
        )}
      </main>

      <Modal open={modal === 'category'} title="New Category" onClose={() => setModal(null)}>
        <form className="form" onSubmit={(e) => {
          e.preventDefault();
          if (!categoryName.trim()) return setMsg('error', 'Category name required');
          void runAction(async () => {
            await apiClient.createCategory({ name: categoryName.trim() });
            setCategoryName('');
            await loadBase();
          }, 'Category created');
        }}>
          <input placeholder="Category name" value={categoryName} onChange={(e) => setCategoryName(e.target.value)} />
          <button type="submit">Create</button>
        </form>
      </Modal>

      <Modal open={modal === 'sku'} title="New SKU" onClose={() => setModal(null)}>
        <form className="form" onSubmit={(e) => {
          e.preventDefault();
          if (!skuForm.sku.trim() || !skuForm.name.trim()) return setMsg('error', 'SKU and Name required');
          if (!isPositive(skuForm.categoryId)) return setMsg('error', 'Category required');
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
      </Modal>

      <Modal open={modal === 'inbound'} title="Inbound" onClose={() => setModal(null)}>
        <InventoryActionForm products={products} state={inboundForm} setState={setInboundForm} onSubmit={(e) => {
          e.preventDefault();
          if (!isPositive(inboundForm.productId) || !isPositive(inboundForm.qty)) return setMsg('error', 'Product and qty must be positive');
          void runAction(async () => {
            await apiClient.inbound({ product_id: toNum(inboundForm.productId), qty: toNum(inboundForm.qty), reason: inboundForm.reason.trim() });
            setInboundForm({ productId: '', qty: '', reason: '' });
            await loadBase();
          }, 'Inbound done');
        }} />
      </Modal>

      <Modal open={modal === 'transitCreate'} title="Transit Create" onClose={() => setModal(null)}>
        <InventoryActionForm products={products} state={transitCreateForm} setState={setTransitCreateForm} onSubmit={(e) => {
          e.preventDefault();
          if (!isPositive(transitCreateForm.productId) || !isPositive(transitCreateForm.qty)) return setMsg('error', 'Product and qty must be positive');
          void runAction(async () => {
            await apiClient.transitCreate({ product_id: toNum(transitCreateForm.productId), qty: toNum(transitCreateForm.qty), reason: transitCreateForm.reason.trim() });
            setTransitCreateForm({ productId: '', qty: '', reason: '' });
            await loadBase();
          }, 'Transit created');
        }} />
      </Modal>

      <Modal open={modal === 'transitReceive'} title="Transit Receive" onClose={() => setModal(null)}>
        <InventoryActionForm products={products} state={transitReceiveForm} setState={setTransitReceiveForm} onSubmit={(e) => {
          e.preventDefault();
          if (!isPositive(transitReceiveForm.productId) || !isPositive(transitReceiveForm.qty)) return setMsg('error', 'Product and qty must be positive');
          void runAction(async () => {
            await apiClient.transitReceive({ product_id: toNum(transitReceiveForm.productId), qty: toNum(transitReceiveForm.qty), reason: transitReceiveForm.reason.trim() });
            setTransitReceiveForm({ productId: '', qty: '', reason: '' });
            await loadBase();
          }, 'Transit received');
        }} />
      </Modal>

      <Modal open={modal === 'reserve'} title="Reserve Stock" onClose={() => setModal(null)}>
        <form className="form" onSubmit={(e) => {
          e.preventDefault();
          if (!isPositive(reserveForm.projectId) || !isPositive(reserveForm.productId) || !isPositive(reserveForm.qty)) return setMsg('error', 'Project/Product/Qty must be positive');
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
          }, 'Reserved');
        }}>
          <select value={reserveForm.projectId} onChange={(e) => setReserveForm({ ...reserveForm, projectId: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">Select project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.project_code} - {p.project_name}</option>)}
          </select>
          <select value={reserveForm.productId} onChange={(e) => setReserveForm({ ...reserveForm, productId: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">Select product</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.sku} - {p.name}</option>)}
          </select>
          <input type="number" placeholder="Qty" value={reserveForm.qty} onChange={(e) => setReserveForm({ ...reserveForm, qty: e.target.value ? Number(e.target.value) : '' })} />
          <input placeholder="Reason" value={reserveForm.reason} onChange={(e) => setReserveForm({ ...reserveForm, reason: e.target.value })} />
          <button type="submit">Submit</button>
        </form>
      </Modal>

      <Modal open={modal === 'consume'} title="Consume Stock" onClose={() => setModal(null)}>
        <form className="form" onSubmit={(e) => {
          e.preventDefault();
          if (!isPositive(consumeForm.reservationId) || !isPositive(consumeForm.qty)) return setMsg('error', 'Reservation and Qty must be positive');
          void runAction(async () => {
            await apiClient.consume({ reservation_id: toNum(consumeForm.reservationId), qty: toNum(consumeForm.qty), note: consumeForm.note.trim() });
            setConsumeForm({ reservationId: '', qty: '', note: '' });
            await loadBase();
            if (selectedProjectId) await loadProjectPanel(selectedProjectId);
          }, 'Consumed');
        }}>
          <select value={consumeProjectId} onChange={(e) => {
            const projectId = e.target.value ? Number(e.target.value) : '';
            setConsumeProjectId(projectId);
            setConsumeForm({ reservationId: '', qty: '', note: '' });
            if (projectId) void loadReservationsForConsume(projectId);
            else setConsumeProjectReservations([]);
          }}>
            <option value="">Select project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.project_code} - {p.project_name}</option>)}
          </select>
          <select value={consumeForm.reservationId} onChange={(e) => setConsumeForm({ ...consumeForm, reservationId: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">Select reservation</option>
            {consumeProjectReservations.filter((r) => r.remaining_qty > 0).map((r) => (
              <option key={r.reservation_id} value={r.reservation_id}>#{r.reservation_id} {r.sku} remain:{r.remaining_qty}</option>
            ))}
          </select>
          <input type="number" placeholder="Qty" value={consumeForm.qty} onChange={(e) => setConsumeForm({ ...consumeForm, qty: e.target.value ? Number(e.target.value) : '' })} />
          <input placeholder="Note" value={consumeForm.note} onChange={(e) => setConsumeForm({ ...consumeForm, note: e.target.value })} />
          <button type="submit">Submit</button>
        </form>
      </Modal>

      <Modal open={modal === 'project'} title="New Project" onClose={() => setModal(null)}>
        <form className="form" onSubmit={(e) => {
          e.preventDefault();
          if (!projectForm.code.trim() || !projectForm.name.trim()) return setMsg('error', 'Project code/name required');
          if (!isPositive(projectForm.ownerId)) return setMsg('error', 'Owner required');
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
          <input placeholder="Project code" value={projectForm.code} onChange={(e) => setProjectForm({ ...projectForm, code: e.target.value })} />
          <input placeholder="Project name" value={projectForm.name} onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })} />
          <select value={projectForm.ownerId} onChange={(e) => setProjectForm({ ...projectForm, ownerId: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">Select owner</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <input placeholder="Note" value={projectForm.note} onChange={(e) => setProjectForm({ ...projectForm, note: e.target.value })} />
          <button type="submit">Create</button>
        </form>
      </Modal>

      <Modal open={modal === 'member'} title="Assign Project Member" onClose={() => setModal(null)}>
        <form className="form" onSubmit={(e) => {
          e.preventDefault();
          if (!selectedProjectId) return setMsg('error', 'Select project first');
          if (!isPositive(memberForm.userId) || !memberForm.projectRole.trim()) return setMsg('error', 'User and role required');
          void runAction(async () => {
            await apiClient.addProjectMember(selectedProjectId, {
              user_id: toNum(memberForm.userId),
              project_role: memberForm.projectRole.trim(),
            });
            setMemberForm({ userId: '', projectRole: 'Developer' });
            await loadProjectPanel(selectedProjectId);
          }, 'Member assigned');
        }}>
          <input value={selectedProject?.project_code || ''} readOnly />
          <select value={memberForm.userId} onChange={(e) => setMemberForm({ ...memberForm, userId: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">Select user</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
          </select>
          <input placeholder="Project role" value={memberForm.projectRole} onChange={(e) => setMemberForm({ ...memberForm, projectRole: e.target.value })} />
          <button type="submit">Assign</button>
        </form>
      </Modal>

      <Modal open={modal === 'commit'} title="Submit Project Commit" onClose={() => setModal(null)}>
        <form className="form" onSubmit={(e) => {
          e.preventDefault();
          if (!selectedProjectId) return setMsg('error', 'Select project first');
          if (!commitForm.title.trim() || !commitForm.content.trim()) return setMsg('error', 'Title/content required');
          void runAction(async () => {
            await apiClient.createProjectCommit(selectedProjectId, {
              title: commitForm.title.trim(),
              content: commitForm.content.trim(),
              status_to: commitForm.statusTo,
              progress_pct: Number(commitForm.progress),
            });
            setCommitForm({ title: '', content: '', statusTo: 'active', progress: 0 });
            await loadBase();
            await loadProjectPanel(selectedProjectId);
          }, 'Commit submitted');
        }}>
          <input value={selectedProject?.project_code || ''} readOnly />
          <input placeholder="Title" value={commitForm.title} onChange={(e) => setCommitForm({ ...commitForm, title: e.target.value })} />
          <textarea placeholder="Content" value={commitForm.content} onChange={(e) => setCommitForm({ ...commitForm, content: e.target.value })} />
          <div className="row2">
            <select value={commitForm.statusTo} onChange={(e) => setCommitForm({ ...commitForm, statusTo: e.target.value as (typeof projectStatusOptions)[number] })}>
              {projectStatusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input type="number" min={0} max={100} value={commitForm.progress} onChange={(e) => setCommitForm({ ...commitForm, progress: Number(e.target.value) })} />
          </div>
          <button type="submit">Submit</button>
        </form>
      </Modal>

      <Modal open={modal === 'user'} title="New User" onClose={() => setModal(null)}>
        <form className="form" onSubmit={(e) => {
          e.preventDefault();
          if (!userForm.email.trim() || !userForm.name.trim() || !userForm.password.trim()) return setMsg('error', 'All fields required');
          void runAction(async () => {
            await apiClient.createUser({
              email: userForm.email.trim(),
              name: userForm.name.trim(),
              password: userForm.password,
              role: userForm.role,
            });
            setUserForm({ email: '', name: '', password: '', role: 'visitor' });
            await loadBase();
          }, 'User created');
        }}>
          <input placeholder="Email" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} />
          <input placeholder="Name" value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })} />
          <input type="password" placeholder="Password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} />
          <select value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value as 'admin' | 'visitor' })}>
            <option value="visitor">visitor</option>
            <option value="admin">admin</option>
          </select>
          <button type="submit">Create</button>
        </form>
      </Modal>
    </div>
  );
}
function InventoryActionForm(props: {
  products: Product[];
  state: { productId: NumInput; qty: NumInput; reason: string };
  setState: (v: { productId: NumInput; qty: NumInput; reason: string }) => void;
  onSubmit: (e: FormEvent) => void;
}) {
  const { products, state, setState, onSubmit } = props;
  return (
    <form className="form" onSubmit={onSubmit}>
      <select value={state.productId} onChange={(e) => setState({ ...state, productId: e.target.value ? Number(e.target.value) : '' })}>
        <option value="">Select product</option>
        {products.map((p) => <option key={p.id} value={p.id}>{p.sku} - {p.name}</option>)}
      </select>
      <input type="number" placeholder="Qty" value={state.qty} onChange={(e) => setState({ ...state, qty: e.target.value ? Number(e.target.value) : '' })} />
      <input placeholder="Reason" value={state.reason} onChange={(e) => setState({ ...state, reason: e.target.value })} />
      <button type="submit">Submit</button>
    </form>
  );
}

function Modal(props: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const { open, title, onClose, children } = props;
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h4>{title}</h4>
          <button className="close-btn" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}
