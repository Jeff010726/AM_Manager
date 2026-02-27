import { FormEvent, useEffect, useMemo, useState } from 'react';
import { apiClient } from './api';
import type { Category, InventoryItem, Product, Project, ProjectCommit, ProjectMember, User } from './types';

type ViewTab = 'dashboard' | 'inventory' | 'projects' | 'master' | 'users';

const initialLogin = { email: 'admin@example.com', password: 'admin123' };

export function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('am_token'));
  const [me, setMe] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [tab, setTab] = useState<ViewTab>('dashboard');

  const [users, setUsers] = useState<User[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);

  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [commits, setCommits] = useState<ProjectCommit[]>([]);

  const [loginForm, setLoginForm] = useState(initialLogin);
  const [userForm, setUserForm] = useState({ email: '', name: '', password: '', role: 'visitor' as const });
  const [categoryForm, setCategoryForm] = useState({ name: '' });
  const [productForm, setProductForm] = useState({ sku: '', name: '', category_id: 0, unit: 'pcs', spec: '', safety_stock_qty: 0, status: 'active' as const });
  const [projectForm, setProjectForm] = useState({ project_code: '', project_name: '', owner_user_id: 0, status: 'planned' as const, note: '' });
  const [memberForm, setMemberForm] = useState({ user_id: 0, project_role: '开发' });
  const [commitForm, setCommitForm] = useState({ title: '', content: '', status_to: 'active' as const, progress_pct: 0 });
  const [inventoryForm, setInventoryForm] = useState({ action: 'inbound', product_id: 0, qty: 0, project_id: 0, reservation_id: 0, reason: '' });

  const isAdmin = me?.role === 'admin';

  async function loadBaseData() {
    setLoading(true);
    setError('');
    try {
      const [meData, categoriesData, productsData, projectsData, inventoryData] = await Promise.all([
        apiClient.me(),
        apiClient.listCategories(),
        apiClient.listProducts(),
        apiClient.listProjects(),
        apiClient.listInventorySummary(),
      ]);
      setMe(meData);
      setCategories(categoriesData);
      setProducts(productsData);
      setProjects(projectsData);
      setInventory(inventoryData);

      if (meData.role === 'admin') {
        const userList = await apiClient.listUsers();
        setUsers(userList);
      }

      if (projectsData.length > 0) {
        const projectId = selectedProjectId ?? projectsData[0].id;
        setSelectedProjectId(projectId);
      }
    } catch (e) {
      setError((e as Error).message);
      if ((e as Error).message.toLowerCase().includes('token')) {
        logout();
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadProjectDetails(projectId: number) {
    setLoading(true);
    setError('');
    try {
      const [memberRows, commitRows] = await Promise.all([apiClient.listProjectMembers(projectId), apiClient.listProjectCommits(projectId)]);
      setMembers(memberRows);
      setCommits(commitRows);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!token) return;
    apiClient.setToken(token);
    loadBaseData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!selectedProjectId || !token) return;
    loadProjectDetails(selectedProjectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId, token]);

  const selectedProject = useMemo(() => projects.find((p) => p.id === selectedProjectId) || null, [projects, selectedProjectId]);

  function logout() {
    localStorage.removeItem('am_token');
    setToken(null);
    setMe(null);
    setUsers([]);
    setCategories([]);
    setProducts([]);
    setProjects([]);
    setInventory([]);
    setMembers([]);
    setCommits([]);
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const resp = await apiClient.login(loginForm.email, loginForm.password);
      localStorage.setItem('am_token', resp.token);
      apiClient.setToken(resp.token);
      setToken(resp.token);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function submitUser(e: FormEvent) {
    e.preventDefault();
    try {
      await apiClient.createUser(userForm);
      setUserForm({ email: '', name: '', password: '', role: 'visitor' });
      await loadBaseData();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function submitCategory(e: FormEvent) {
    e.preventDefault();
    try {
      await apiClient.createCategory({ name: categoryForm.name });
      setCategoryForm({ name: '' });
      await loadBaseData();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function submitProduct(e: FormEvent) {
    e.preventDefault();
    try {
      await apiClient.createProduct(productForm);
      setProductForm({ sku: '', name: '', category_id: 0, unit: 'pcs', spec: '', safety_stock_qty: 0, status: 'active' });
      await loadBaseData();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function submitProject(e: FormEvent) {
    e.preventDefault();
    try {
      await apiClient.createProject(projectForm);
      setProjectForm({ project_code: '', project_name: '', owner_user_id: 0, status: 'planned', note: '' });
      await loadBaseData();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function submitProjectMember(e: FormEvent) {
    e.preventDefault();
    if (!selectedProjectId) return;
    try {
      await apiClient.addProjectMember(selectedProjectId, memberForm);
      setMemberForm({ user_id: 0, project_role: '开发' });
      await loadProjectDetails(selectedProjectId);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function submitCommit(e: FormEvent) {
    e.preventDefault();
    if (!selectedProjectId) return;
    try {
      await apiClient.createProjectCommit(selectedProjectId, commitForm);
      setCommitForm({ title: '', content: '', status_to: 'active', progress_pct: 0 });
      await loadBaseData();
      await loadProjectDetails(selectedProjectId);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function submitInventory(e: FormEvent) {
    e.preventDefault();
    try {
      if (inventoryForm.action === 'inbound') {
        await apiClient.inbound({ product_id: inventoryForm.product_id, qty: inventoryForm.qty, reason: inventoryForm.reason });
      } else if (inventoryForm.action === 'transit_create') {
        await apiClient.transitCreate({ product_id: inventoryForm.product_id, qty: inventoryForm.qty, reason: inventoryForm.reason });
      } else if (inventoryForm.action === 'transit_receive') {
        await apiClient.transitReceive({ product_id: inventoryForm.product_id, qty: inventoryForm.qty, reason: inventoryForm.reason });
      } else if (inventoryForm.action === 'reserve') {
        await apiClient.reserve({
          project_id: inventoryForm.project_id,
          product_id: inventoryForm.product_id,
          qty: inventoryForm.qty,
          reason: inventoryForm.reason,
        });
      } else if (inventoryForm.action === 'consume') {
        await apiClient.consume({ reservation_id: inventoryForm.reservation_id, qty: inventoryForm.qty, note: inventoryForm.reason });
      }
      setInventoryForm({ action: 'inbound', product_id: 0, qty: 0, project_id: 0, reservation_id: 0, reason: '' });
      await loadBaseData();
      if (selectedProjectId) await loadProjectDetails(selectedProjectId);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!token) {
    return (
      <div className="auth-shell">
        <div className="grain" />
        <form className="auth-card" onSubmit={handleLogin}>
          <h1>AM Manager</h1>
          <p>轻量 ERP 控制台（默认账号：admin@example.com / admin123）</p>
          <label>
            Email
            <input value={loginForm.email} onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })} />
          </label>
          <label>
            Password
            <input type="password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} />
          </label>
          <button disabled={loading} type="submit">{loading ? '登录中...' : '登录'}</button>
          {error && <div className="error">{error}</div>}
        </form>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h2>AM Ops Console</h2>
        <p>{me?.name} · {me?.role}</p>
        <button className={tab === 'dashboard' ? 'active' : ''} onClick={() => setTab('dashboard')}>总览</button>
        <button className={tab === 'inventory' ? 'active' : ''} onClick={() => setTab('inventory')}>库存</button>
        <button className={tab === 'projects' ? 'active' : ''} onClick={() => setTab('projects')}>项目</button>
        <button className={tab === 'master' ? 'active' : ''} onClick={() => setTab('master')}>主数据</button>
        {isAdmin && <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>用户</button>}
        <button className="logout" onClick={logout}>退出</button>
      </aside>

      <main className="main">
        <header>
          <h1>AM Manager</h1>
          <button onClick={() => void loadBaseData()} disabled={loading}>{loading ? '刷新中...' : '刷新'}</button>
        </header>

        {error && <div className="error">{error}</div>}

        {tab === 'dashboard' && (
          <section>
            <h3>库存口径总览</h3>
            <div className="cards">
              <div className="card"><span>SKU 数</span><strong>{inventory.length}</strong></div>
              <div className="card"><span>总库存</span><strong>{inventory.reduce((a, b) => a + b.total_stock_qty, 0)}</strong></div>
              <div className="card"><span>可用库存</span><strong>{inventory.reduce((a, b) => a + b.available_qty, 0)}</strong></div>
              <div className="card"><span>预留库存</span><strong>{inventory.reduce((a, b) => a + b.reserved_qty, 0)}</strong></div>
              <div className="card"><span>在途库存</span><strong>{inventory.reduce((a, b) => a + b.in_transit_qty, 0)}</strong></div>
              <div className="card"><span>已消耗</span><strong>{inventory.reduce((a, b) => a + b.consumed_qty, 0)}</strong></div>
            </div>
          </section>
        )}

        {tab === 'inventory' && (
          <section>
            <h3>库存管理（先预留后消耗）</h3>
            {isAdmin && (
              <form className="inline-form" onSubmit={submitInventory}>
                <select value={inventoryForm.action} onChange={(e) => setInventoryForm({ ...inventoryForm, action: e.target.value })}>
                  <option value="inbound">入库</option>
                  <option value="transit_create">在途登记</option>
                  <option value="transit_receive">在途入库</option>
                  <option value="reserve">项目预留</option>
                  <option value="consume">项目消耗</option>
                </select>
                <input type="number" placeholder="产品ID" value={inventoryForm.product_id || ''} onChange={(e) => setInventoryForm({ ...inventoryForm, product_id: Number(e.target.value) })} />
                <input type="number" placeholder="数量" value={inventoryForm.qty || ''} onChange={(e) => setInventoryForm({ ...inventoryForm, qty: Number(e.target.value) })} />
                <input type="number" placeholder="项目ID(预留用)" value={inventoryForm.project_id || ''} onChange={(e) => setInventoryForm({ ...inventoryForm, project_id: Number(e.target.value) })} />
                <input type="number" placeholder="预留ID(消耗用)" value={inventoryForm.reservation_id || ''} onChange={(e) => setInventoryForm({ ...inventoryForm, reservation_id: Number(e.target.value) })} />
                <input placeholder="备注" value={inventoryForm.reason} onChange={(e) => setInventoryForm({ ...inventoryForm, reason: e.target.value })} />
                <button type="submit">提交库存操作</button>
              </form>
            )}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>SKU</th><th>名称</th><th>总库存</th><th>在途</th><th>在库</th><th>可用</th><th>预留</th><th>消耗</th><th>安全库存</th><th>缺口</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.map((item) => (
                    <tr key={item.product_id}>
                      <td>{item.sku}</td><td>{item.name}</td><td>{item.total_stock_qty}</td><td>{item.in_transit_qty}</td><td>{item.on_hand_qty}</td><td>{item.available_qty}</td><td>{item.reserved_qty}</td><td>{item.consumed_qty}</td><td>{item.safety_stock_qty}</td><td>{item.shortage_qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {tab === 'projects' && (
          <section>
            <h3>项目协作与 Commit 流</h3>
            <div className="split">
              <div>
                <h4>项目列表</h4>
                <div className="project-list">
                  {projects.map((p) => (
                    <button key={p.id} className={selectedProjectId === p.id ? 'project active' : 'project'} onClick={() => setSelectedProjectId(p.id)}>
                      <strong>{p.project_code}</strong>
                      <span>{p.project_name}</span>
                      <em>{p.status}</em>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <h4>项目详情 {selectedProject ? `#${selectedProject.project_code}` : ''}</h4>
                {selectedProject && (
                  <>
                    <div className="grid-two">
                      <div>
                        <h5>成员</h5>
                        {isAdmin && (
                          <form className="inline-form" onSubmit={submitProjectMember}>
                            <input type="number" placeholder="用户ID" value={memberForm.user_id || ''} onChange={(e) => setMemberForm({ ...memberForm, user_id: Number(e.target.value) })} />
                            <input placeholder="项目角色" value={memberForm.project_role} onChange={(e) => setMemberForm({ ...memberForm, project_role: e.target.value })} />
                            <button type="submit">添加成员</button>
                          </form>
                        )}
                        <ul className="list">
                          {members.map((m) => (
                            <li key={m.user_id}>{m.name} ({m.system_role}) · {m.project_role}</li>
                          ))}
                        </ul>
                      </div>

                      <div>
                        <h5>提交 Commit</h5>
                        <form className="stack-form" onSubmit={submitCommit}>
                          <input placeholder="标题" value={commitForm.title} onChange={(e) => setCommitForm({ ...commitForm, title: e.target.value })} />
                          <textarea placeholder="更新说明" value={commitForm.content} onChange={(e) => setCommitForm({ ...commitForm, content: e.target.value })} />
                          <div className="inline-form">
                            <select value={commitForm.status_to} onChange={(e) => setCommitForm({ ...commitForm, status_to: e.target.value as any })}>
                              <option value="planned">planned</option>
                              <option value="active">active</option>
                              <option value="blocked">blocked</option>
                              <option value="done">done</option>
                              <option value="cancelled">cancelled</option>
                            </select>
                            <input type="number" min={0} max={100} placeholder="进度%" value={commitForm.progress_pct} onChange={(e) => setCommitForm({ ...commitForm, progress_pct: Number(e.target.value) })} />
                            <button type="submit">提交 Commit</button>
                          </div>
                        </form>
                      </div>
                    </div>

                    <h5>Commit 时间线</h5>
                    <ul className="timeline">
                      {commits.map((c) => (
                        <li key={c.commit_id}>
                          <div className="dot" />
                          <div>
                            <strong>#{c.seq_no} {c.title}</strong>
                            <p>{c.content}</p>
                            <small>{c.author_name} · {c.author_system_role}/{c.author_project_role} · {c.status_from} → {c.status_to} · {new Date(c.created_at).toLocaleString()}</small>
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

        {tab === 'master' && (
          <section>
            <h3>主数据</h3>
            {isAdmin && (
              <div className="grid-two">
                <form className="stack-form" onSubmit={submitCategory}>
                  <h5>新增分类</h5>
                  <input placeholder="分类名" value={categoryForm.name} onChange={(e) => setCategoryForm({ name: e.target.value })} />
                  <button type="submit">创建分类</button>
                </form>

                <form className="stack-form" onSubmit={submitProduct}>
                  <h5>新增产品 SKU</h5>
                  <input placeholder="SKU" value={productForm.sku} onChange={(e) => setProductForm({ ...productForm, sku: e.target.value })} />
                  <input placeholder="名称" value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} />
                  <select value={productForm.category_id} onChange={(e) => setProductForm({ ...productForm, category_id: Number(e.target.value) })}>
                    <option value={0}>选择分类</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <input placeholder="单位" value={productForm.unit} onChange={(e) => setProductForm({ ...productForm, unit: e.target.value })} />
                  <input placeholder="规格" value={productForm.spec} onChange={(e) => setProductForm({ ...productForm, spec: e.target.value })} />
                  <input type="number" placeholder="安全库存" value={productForm.safety_stock_qty} onChange={(e) => setProductForm({ ...productForm, safety_stock_qty: Number(e.target.value) })} />
                  <button type="submit">创建产品</button>
                </form>
              </div>
            )}
            <div className="table-wrap">
              <table>
                <thead><tr><th>SKU</th><th>名称</th><th>分类</th><th>单位</th><th>状态</th></tr></thead>
                <tbody>{products.map((p) => <tr key={p.id}><td>{p.sku}</td><td>{p.name}</td><td>{p.category_name}</td><td>{p.unit}</td><td>{p.status}</td></tr>)}</tbody>
              </table>
            </div>
            {isAdmin && (
              <form className="inline-form" onSubmit={submitProject}>
                <input placeholder="项目编码" value={projectForm.project_code} onChange={(e) => setProjectForm({ ...projectForm, project_code: e.target.value })} />
                <input placeholder="项目名称" value={projectForm.project_name} onChange={(e) => setProjectForm({ ...projectForm, project_name: e.target.value })} />
                <input type="number" placeholder="负责人用户ID" value={projectForm.owner_user_id || ''} onChange={(e) => setProjectForm({ ...projectForm, owner_user_id: Number(e.target.value) })} />
                <button type="submit">创建项目</button>
              </form>
            )}
          </section>
        )}

        {tab === 'users' && isAdmin && (
          <section>
            <h3>用户管理</h3>
            <form className="inline-form" onSubmit={submitUser}>
              <input placeholder="邮箱" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} />
              <input placeholder="姓名" value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })} />
              <input type="password" placeholder="密码" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} />
              <select value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value as any })}>
                <option value="visitor">visitor</option>
                <option value="admin">admin</option>
              </select>
              <button type="submit">创建用户</button>
            </form>
            <div className="table-wrap">
              <table>
                <thead><tr><th>ID</th><th>姓名</th><th>邮箱</th><th>角色</th><th>状态</th></tr></thead>
                <tbody>{users.map((u) => <tr key={u.id}><td>{u.id}</td><td>{u.name}</td><td>{u.email}</td><td>{u.role}</td><td>{u.status}</td></tr>)}</tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
