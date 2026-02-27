
import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { apiClient } from './api';
import type {
  Category,
  InventoryItem,
  InventoryTransaction,
  Product,
  Project,
  ProjectCommit,
  ProjectMember,
  ProjectReservation,
  User,
} from './types';

type Tab = 'sku' | 'inventory' | 'projects' | 'users';
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

const operationTypeLabel: Record<string, string> = {
  INBOUND: '入库',
  OUTBOUND: '出库',
  TRANSIT_CREATE: '创建在途',
  TRANSIT_RECEIVE: '在途入库',
  RESERVE: '预留',
  RELEASE: '释放预留',
  CONSUME: '消耗',
  ADJUST: '库存调整',
};

function toNum(value: NumInput) {
  return typeof value === 'number' ? value : Number(value);
}

function isPositive(value: NumInput) {
  const parsed = toNum(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function fmtDateTime(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function roleLabel(role: string) {
  if (role === 'admin') return '管理员';
  if (role === 'visitor') return '访客';
  return role;
}

export function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('am_token'));
  const [modal, setModal] = useState<ModalType>(null);
  const [tab, setTab] = useState<Tab>('inventory');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [me, setMe] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);

  const [selectedInventoryProductId, setSelectedInventoryProductId] = useState<number | null>(null);
  const [inventoryTransactions, setInventoryTransactions] = useState<InventoryTransaction[]>([]);
  const [inventoryDetailLoading, setInventoryDetailLoading] = useState(false);

  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [projectDetailLoading, setProjectDetailLoading] = useState(false);
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
  const [memberForm, setMemberForm] = useState({ userId: '' as NumInput, projectRole: '成员' });
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
  const [reserveForm, setReserveForm] = useState({ projectId: '' as NumInput, productId: '' as NumInput, qty: '' as NumInput, reason: '' });
  const [consumeForm, setConsumeForm] = useState({ reservationId: '' as NumInput, qty: '' as NumInput, note: '' });

  const isAdmin = me?.role === 'admin';

  const inventoryRows = useMemo(
    () => [...inventory].sort((a, b) => a.sku.localeCompare(b.sku, 'en', { sensitivity: 'base' })),
    [inventory],
  );
  const skuRows = useMemo(
    () => [...products].sort((a, b) => a.sku.localeCompare(b.sku, 'en', { sensitivity: 'base' })),
    [products],
  );

  const productById = useMemo(() => new Map(products.map((item) => [item.id, item])), [products]);
  const inventoryByProductId = useMemo(() => new Map(inventory.map((item) => [item.product_id, item])), [inventory]);

  const selectedInventoryProduct = selectedInventoryProductId ? productById.get(selectedInventoryProductId) ?? null : null;
  const selectedInventoryBalance = selectedInventoryProductId ? inventoryByProductId.get(selectedInventoryProductId) ?? null : null;
  const selectedProject = selectedProjectId ? projects.find((item) => item.id === selectedProjectId) ?? null : null;

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

  async function loadInventoryDetail(productId: number) {
    setInventoryDetailLoading(true);
    try {
      const txs = await apiClient.listInventoryTransactions(productId, 1000);
      setInventoryTransactions(txs);
      setSelectedInventoryProductId(productId);
    } catch (e) {
      setMsg('error', (e as Error).message);
    } finally {
      setInventoryDetailLoading(false);
    }
  }

  async function loadProjectDetail(projectId: number) {
    setProjectDetailLoading(true);
    try {
      const [memberData, commitData, reservationData] = await Promise.all([
        apiClient.listProjectMembers(projectId),
        apiClient.listProjectCommits(projectId),
        apiClient.listProjectReservations(projectId),
      ]);
      setMembers(memberData);
      setCommits(commitData);
      setProjectReservations(reservationData);
      setSelectedProjectId(projectId);
    } catch (e) {
      setMsg('error', (e as Error).message);
    } finally {
      setProjectDetailLoading(false);
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

  function logout() {
    localStorage.removeItem('am_token');
    apiClient.setToken(null);
    setToken(null);
    setTab('inventory');
    setMe(null);
    setUsers([]);
    setCategories([]);
    setProducts([]);
    setProjects([]);
    setInventory([]);
    setSelectedInventoryProductId(null);
    setInventoryTransactions([]);
    setSelectedProjectId(null);
    setMembers([]);
    setCommits([]);
    setProjectReservations([]);
    setConsumeProjectId('');
    setConsumeProjectReservations([]);
    setModal(null);
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
            }, '登录成功', false);
          }}
        >
          <h1>AM 轻量 ERP</h1>
          <p>默认管理员：admin@example.com / admin123</p>
          <label>
            邮箱
            <input value={loginForm.email} onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })} />
          </label>
          <label>
            密码
            <input type="password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} />
          </label>
          <button type="submit" disabled={loading}>登录</button>
          {error && <div className="msg error">{error}</div>}
        </form>
      </div>
    );
  }

  return (
    <div className="layout">
      <aside className="nav">
        <h2>AM ERP</h2>
        <p>{me?.name}（{me?.role === 'admin' ? '管理员' : '访客'}）</p>
        <button className={tab === 'sku' ? 'active' : ''} onClick={() => setTab('sku')}>SKU主数据</button>
        <button className={tab === 'inventory' ? 'active' : ''} onClick={() => setTab('inventory')}>库存</button>
        <button className={tab === 'projects' ? 'active' : ''} onClick={() => setTab('projects')}>项目</button>
        {isAdmin && <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>用户</button>}
        <button className="ghost" disabled={loading} onClick={() => void loadBase()}>刷新</button>
        <button className="logout" onClick={logout}>退出登录</button>
      </aside>

      <main className="content">
        {error && <div className="msg error">{error}</div>}
        {success && <div className="msg ok">{success}</div>}
        {tab === 'sku' && (
          <section className="panel">
            <div className="toolbar">
              <div>
                <h3>SKU 主数据</h3>
                <p className="subtle">仅展示 SKU 主数据，不展示任何库存数量字段。</p>
              </div>
              <div className="tools">
                {isAdmin && (
                  <>
                    <button onClick={() => setModal('category')}>新增分类</button>
                    <button onClick={() => setModal('sku')}>新增 SKU</button>
                  </>
                )}
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>SKU 编号</th>
                    <th>产品名称</th>
                    <th>分类</th>
                    <th>产品型号/规格</th>
                    <th>单位</th>
                    <th>安全库存</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {skuRows.map((item) => (
                    <tr key={item.id}>
                      <td>{item.sku}</td>
                      <td>{item.name}</td>
                      <td>{item.category_name}</td>
                      <td>{item.spec || '-'}</td>
                      <td>{item.unit}</td>
                      <td>{item.safety_stock_qty}</td>
                      <td>{item.status}</td>
                    </tr>
                  ))}
                  {skuRows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="empty-cell">暂无 SKU 数据</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <h4 className="section-title">分类列表</h4>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>分类名称</th>
                    <th>上级分类ID</th>
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
                  {categories.length === 0 && (
                    <tr>
                      <td colSpan={3} className="empty-cell">暂无分类数据</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {tab === 'inventory' && (
          <section className="panel">
            <div className="toolbar">
              <div>
                <h3>库存台账</h3>
                <p className="subtle">点击 SKU 可进入库存详情，查看流水和关联项目。</p>
              </div>
              <div className="tools">
                {isAdmin && (
                  <>
                    <button onClick={() => setModal('inbound')}>入库</button>
                    <button onClick={() => setModal('transitCreate')}>创建在途</button>
                    <button onClick={() => setModal('transitReceive')}>在途入库</button>
                    <button onClick={() => setModal('reserve')}>项目预留</button>
                    <button onClick={() => setModal('consume')}>项目消耗</button>
                  </>
                )}
              </div>
            </div>

            {!selectedInventoryProductId && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>名称</th>
                      <th>总库存</th>
                      <th>在途</th>
                      <th>在手</th>
                      <th>可用</th>
                      <th>预留</th>
                      <th>已消耗</th>
                      <th>安全库存</th>
                      <th>缺口</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventoryRows.map((item) => (
                      <tr key={item.product_id}>
                        <td>
                          <button className="link-btn" onClick={() => void loadInventoryDetail(item.product_id)}>
                            {item.sku}
                          </button>
                        </td>
                        <td>{item.name}</td>
                        <td>{item.total_stock_qty}</td>
                        <td>{item.in_transit_qty}</td>
                        <td>{item.on_hand_qty}</td>
                        <td>{item.available_qty}</td>
                        <td>{item.reserved_qty}</td>
                        <td>{item.consumed_qty}</td>
                        <td>{item.safety_stock_qty}</td>
                        <td>{item.shortage_qty}</td>
                      </tr>
                    ))}
                    {inventoryRows.length === 0 && (
                      <tr>
                        <td colSpan={10} className="empty-cell">暂无库存数据</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {selectedInventoryProductId && selectedInventoryProduct && selectedInventoryBalance && (
              <>
                <div className="detail-head">
                  <button className="back-btn" onClick={() => {
                    setSelectedInventoryProductId(null);
                    setInventoryTransactions([]);
                  }}>返回库存列表</button>
                  <strong>SKU 库存详情：{selectedInventoryProduct.sku}</strong>
                </div>

                <div className="split-grid">
                  <section className="detail-card">
                    <h4 className="minor-title">SKU 信息</h4>
                    <div className="kv-grid">
                      <span>SKU 编号</span><strong>{selectedInventoryProduct.sku}</strong>
                      <span>产品名称</span><strong>{selectedInventoryProduct.name}</strong>
                      <span>分类</span><strong>{selectedInventoryProduct.category_name}</strong>
                      <span>产品型号/规格</span><strong>{selectedInventoryProduct.spec || '-'}</strong>
                      <span>单位</span><strong>{selectedInventoryProduct.unit}</strong>
                      <span>状态</span><strong>{selectedInventoryProduct.status}</strong>
                    </div>
                  </section>

                  <section className="detail-card">
                    <h4 className="minor-title">库存数据</h4>
                    <div className="kv-grid">
                      <span>总库存</span><strong>{selectedInventoryBalance.total_stock_qty}</strong>
                      <span>在途</span><strong>{selectedInventoryBalance.in_transit_qty}</strong>
                      <span>在手</span><strong>{selectedInventoryBalance.on_hand_qty}</strong>
                      <span>可用</span><strong>{selectedInventoryBalance.available_qty}</strong>
                      <span>预留</span><strong>{selectedInventoryBalance.reserved_qty}</strong>
                      <span>已消耗</span><strong>{selectedInventoryBalance.consumed_qty}</strong>
                      <span>安全库存</span><strong>{selectedInventoryBalance.safety_stock_qty}</strong>
                      <span>缺口</span><strong>{selectedInventoryBalance.shortage_qty}</strong>
                    </div>
                  </section>
                </div>

                <h4 className="section-title">库存流水明细</h4>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>时间</th>
                        <th>操作类型</th>
                        <th>数量</th>
                        <th>在手变化</th>
                        <th>在途变化</th>
                        <th>预留变化</th>
                        <th>消耗变化</th>
                        <th>关联项目</th>
                        <th>备注</th>
                        <th>操作人</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inventoryTransactions.map((tx) => (
                        <tr key={tx.id}>
                          <td>{fmtDateTime(tx.created_at)}</td>
                          <td>{operationTypeLabel[tx.operation_type] || tx.operation_type}</td>
                          <td>{tx.qty}</td>
                          <td>{tx.delta_on_hand}</td>
                          <td>{tx.delta_in_transit}</td>
                          <td>{tx.delta_reserved}</td>
                          <td>{tx.delta_consumed}</td>
                          <td>{tx.project_code ? `${tx.project_code} / ${tx.project_name || ''}` : '-'}</td>
                          <td>{tx.reason || '-'}</td>
                          <td>{tx.actor_name}</td>
                        </tr>
                      ))}
                      {inventoryTransactions.length === 0 && !inventoryDetailLoading && (
                        <tr>
                          <td colSpan={10} className="empty-cell">该 SKU 暂无流水记录</td>
                        </tr>
                      )}
                      {inventoryDetailLoading && (
                        <tr>
                          <td colSpan={10} className="empty-cell">流水加载中...</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        )}

        {tab === 'projects' && (
          <section className="panel">
            {!selectedProjectId && (
              <>
                <div className="toolbar">
                  <div>
                    <h3>项目列表</h3>
                    <p className="subtle">点击项目名称进入详情，再查看成员、预留库存和 Commit。</p>
                  </div>
                  <div className="tools">
                    {isAdmin && <button onClick={() => setModal('project')}>新增项目</button>}
                  </div>
                </div>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>项目编码</th>
                        <th>项目名称</th>
                        <th>状态</th>
                        <th>负责人</th>
                        <th>备注</th>
                        <th>开始日期</th>
                        <th>结束日期</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projects.map((item) => (
                        <tr key={item.id}>
                          <td>{item.project_code}</td>
                          <td>
                            <button className="link-btn" onClick={() => void loadProjectDetail(item.id)}>
                              {item.project_name}
                            </button>
                          </td>
                          <td>{item.status}</td>
                          <td>{item.owner_name}</td>
                          <td>{item.note || '-'}</td>
                          <td>{item.start_date || '-'}</td>
                          <td>{item.end_date || '-'}</td>
                        </tr>
                      ))}
                      {projects.length === 0 && (
                        <tr>
                          <td colSpan={7} className="empty-cell">暂无项目数据</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {selectedProjectId && selectedProject && (
              <>
                <div className="toolbar">
                  <div>
                    <button className="back-btn" onClick={() => {
                      setSelectedProjectId(null);
                      setMembers([]);
                      setCommits([]);
                      setProjectReservations([]);
                    }}>返回项目列表</button>
                    <h3>{selectedProject.project_code} / {selectedProject.project_name}</h3>
                    <p className="subtle">项目状态：{selectedProject.status}，负责人：{selectedProject.owner_name}</p>
                  </div>
                  <div className="tools">
                    {isAdmin && <button onClick={() => setModal('member')}>分配成员</button>}
                    <button onClick={() => setModal('commit')}>提交 Commit</button>
                  </div>
                </div>
                {projectDetailLoading && <div className="msg ok">项目详情加载中...</div>}

                <h4 className="section-title">项目成员</h4>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>成员</th>
                        <th>系统角色</th>
                        <th>项目角色</th>
                        <th>加入时间</th>
                        <th>最近提交</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((m) => (
                        <tr key={m.user_id}>
                          <td>{m.name}</td>
                          <td>{roleLabel(m.system_role)}</td>
                          <td>{m.project_role}</td>
                          <td>{fmtDateTime(m.joined_at)}</td>
                          <td>{fmtDateTime(m.last_commit_at)}</td>
                        </tr>
                      ))}
                      {members.length === 0 && (
                        <tr>
                          <td colSpan={5} className="empty-cell">暂无成员数据</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <h4 className="section-title">项目预留库存</h4>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>预留ID</th>
                        <th>SKU</th>
                        <th>产品名称</th>
                        <th>预留数量</th>
                        <th>已消耗</th>
                        <th>已释放</th>
                        <th>剩余</th>
                        <th>状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projectReservations.map((r) => (
                        <tr key={r.reservation_id}>
                          <td>{r.reservation_id}</td>
                          <td>{r.sku}</td>
                          <td>{r.product_name}</td>
                          <td>{r.qty}</td>
                          <td>{r.consumed_qty}</td>
                          <td>{r.released_qty}</td>
                          <td>{r.remaining_qty}</td>
                          <td>{r.status}</td>
                        </tr>
                      ))}
                      {projectReservations.length === 0 && (
                        <tr>
                          <td colSpan={8} className="empty-cell">暂无预留记录</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <h4 className="section-title">项目 Commit 记录</h4>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>序号</th>
                        <th>标题</th>
                        <th>内容</th>
                        <th>作者</th>
                        <th>角色</th>
                        <th>状态流转</th>
                        <th>进度</th>
                        <th>时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {commits.map((c) => (
                        <tr key={c.commit_id}>
                          <td>{c.seq_no}</td>
                          <td>{c.title}</td>
                          <td>{c.content}</td>
                          <td>{c.author_name}</td>
                          <td>{roleLabel(c.author_system_role)} / {c.author_project_role}</td>
                          <td>{c.status_from} to {c.status_to}</td>
                          <td>{typeof c.progress_pct === 'number' ? `${c.progress_pct}%` : '-'}</td>
                          <td>{fmtDateTime(c.created_at)}</td>
                        </tr>
                      ))}
                      {commits.length === 0 && (
                        <tr>
                          <td colSpan={8} className="empty-cell">暂无 Commit 记录</td>
                        </tr>
                      )}
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
                <h3>用户管理</h3>
                <p className="subtle">仅管理员可创建用户。</p>
              </div>
              <div className="tools">
                <button onClick={() => setModal('user')}>新增用户</button>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>姓名</th>
                    <th>邮箱</th>
                    <th>角色</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.id}</td>
                      <td>{u.name}</td>
                      <td>{u.email}</td>
                      <td>{roleLabel(u.role)}</td>
                      <td>{u.status}</td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={5} className="empty-cell">暂无用户数据</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>

      <Modal open={modal === 'category'} title="新增分类" onClose={() => setModal(null)}>
        <form className="form" onSubmit={(e) => {
          e.preventDefault();
          if (!categoryName.trim()) return setMsg('error', '分类名称不能为空');
          void runAction(async () => {
            await apiClient.createCategory({ name: categoryName.trim() });
            setCategoryName('');
            await loadBase();
          }, '分类创建成功');
        }}>
          <input placeholder="分类名称" value={categoryName} onChange={(e) => setCategoryName(e.target.value)} />
          <button type="submit">提交</button>
        </form>
      </Modal>

      <Modal open={modal === 'sku'} title="新增 SKU" onClose={() => setModal(null)}>
        <form className="form" onSubmit={(e) => {
          e.preventDefault();
          if (!skuForm.sku.trim() || !skuForm.name.trim()) return setMsg('error', '请填写 SKU 编号和产品名称');
          if (!isPositive(skuForm.categoryId)) return setMsg('error', '请选择分类');
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
          }, 'SKU 创建成功');
        }}>
          <input placeholder="SKU 编号" value={skuForm.sku} onChange={(e) => setSkuForm({ ...skuForm, sku: e.target.value })} />
          <input placeholder="产品名称" value={skuForm.name} onChange={(e) => setSkuForm({ ...skuForm, name: e.target.value })} />
          <select value={skuForm.categoryId} onChange={(e) => setSkuForm({ ...skuForm, categoryId: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">选择分类</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="row2">
            <input placeholder="单位" value={skuForm.unit} onChange={(e) => setSkuForm({ ...skuForm, unit: e.target.value })} />
            <input type="number" placeholder="安全库存" value={skuForm.safetyStock} onChange={(e) => setSkuForm({ ...skuForm, safetyStock: Number(e.target.value) })} />
          </div>
          <input placeholder="产品型号/规格" value={skuForm.spec} onChange={(e) => setSkuForm({ ...skuForm, spec: e.target.value })} />
          <button type="submit">提交</button>
        </form>
      </Modal>

      <Modal open={modal === 'inbound'} title="库存入库" onClose={() => setModal(null)}>
        <InventoryActionForm products={products} state={inboundForm} setState={setInboundForm} onSubmit={(e) => {
          e.preventDefault();
          if (!isPositive(inboundForm.productId) || !isPositive(inboundForm.qty)) return setMsg('error', '请选择产品并输入正整数数量');
          void runAction(async () => {
            await apiClient.inbound({ product_id: toNum(inboundForm.productId), qty: toNum(inboundForm.qty), reason: inboundForm.reason.trim() });
            setInboundForm({ productId: '', qty: '', reason: '' });
            await loadBase();
            if (selectedInventoryProductId) await loadInventoryDetail(selectedInventoryProductId);
          }, '入库成功');
        }} />
      </Modal>

      <Modal open={modal === 'transitCreate'} title="创建在途" onClose={() => setModal(null)}>
        <InventoryActionForm products={products} state={transitCreateForm} setState={setTransitCreateForm} onSubmit={(e) => {
          e.preventDefault();
          if (!isPositive(transitCreateForm.productId) || !isPositive(transitCreateForm.qty)) return setMsg('error', '请选择产品并输入正整数数量');
          void runAction(async () => {
            await apiClient.transitCreate({ product_id: toNum(transitCreateForm.productId), qty: toNum(transitCreateForm.qty), reason: transitCreateForm.reason.trim() });
            setTransitCreateForm({ productId: '', qty: '', reason: '' });
            await loadBase();
            if (selectedInventoryProductId) await loadInventoryDetail(selectedInventoryProductId);
          }, '在途创建成功');
        }} />
      </Modal>

      <Modal open={modal === 'transitReceive'} title="在途入库" onClose={() => setModal(null)}>
        <InventoryActionForm products={products} state={transitReceiveForm} setState={setTransitReceiveForm} onSubmit={(e) => {
          e.preventDefault();
          if (!isPositive(transitReceiveForm.productId) || !isPositive(transitReceiveForm.qty)) return setMsg('error', '请选择产品并输入正整数数量');
          void runAction(async () => {
            await apiClient.transitReceive({ product_id: toNum(transitReceiveForm.productId), qty: toNum(transitReceiveForm.qty), reason: transitReceiveForm.reason.trim() });
            setTransitReceiveForm({ productId: '', qty: '', reason: '' });
            await loadBase();
            if (selectedInventoryProductId) await loadInventoryDetail(selectedInventoryProductId);
          }, '在途入库成功');
        }} />
      </Modal>

      <Modal open={modal === 'reserve'} title="项目库存预留" onClose={() => setModal(null)}>
        <form className="form" onSubmit={(e) => {
          e.preventDefault();
          if (!isPositive(reserveForm.projectId) || !isPositive(reserveForm.productId) || !isPositive(reserveForm.qty)) return setMsg('error', '项目、SKU、数量均为必填且数量需为正整数');
          void runAction(async () => {
            await apiClient.reserve({
              project_id: toNum(reserveForm.projectId),
              product_id: toNum(reserveForm.productId),
              qty: toNum(reserveForm.qty),
              reason: reserveForm.reason.trim(),
            });
            setReserveForm({ projectId: '', productId: '', qty: '', reason: '' });
            await loadBase();
            if (selectedInventoryProductId) await loadInventoryDetail(selectedInventoryProductId);
            if (selectedProjectId) await loadProjectDetail(selectedProjectId);
          }, '预留成功');
        }}>
          <select value={reserveForm.projectId} onChange={(e) => setReserveForm({ ...reserveForm, projectId: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">选择项目</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.project_code} / {p.project_name}</option>)}
          </select>
          <select value={reserveForm.productId} onChange={(e) => setReserveForm({ ...reserveForm, productId: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">选择 SKU</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.sku} / {p.name}</option>)}
          </select>
          <input type="number" placeholder="预留数量" value={reserveForm.qty} onChange={(e) => setReserveForm({ ...reserveForm, qty: e.target.value ? Number(e.target.value) : '' })} />
          <input placeholder="备注" value={reserveForm.reason} onChange={(e) => setReserveForm({ ...reserveForm, reason: e.target.value })} />
          <button type="submit">提交</button>
        </form>
      </Modal>

      <Modal open={modal === 'consume'} title="项目库存消耗" onClose={() => setModal(null)}>
        <form className="form" onSubmit={(e) => {
          e.preventDefault();
          if (!isPositive(consumeForm.reservationId) || !isPositive(consumeForm.qty)) return setMsg('error', '请选择预留记录并输入正整数数量');
          void runAction(async () => {
            await apiClient.consume({ reservation_id: toNum(consumeForm.reservationId), qty: toNum(consumeForm.qty), note: consumeForm.note.trim() });
            setConsumeForm({ reservationId: '', qty: '', note: '' });
            await loadBase();
            if (selectedInventoryProductId) await loadInventoryDetail(selectedInventoryProductId);
            if (selectedProjectId) await loadProjectDetail(selectedProjectId);
          }, '消耗成功');
        }}>
          <select value={consumeProjectId} onChange={(e) => {
            const pid = e.target.value ? Number(e.target.value) : '';
            setConsumeProjectId(pid);
            setConsumeForm({ reservationId: '', qty: '', note: '' });
            if (pid) void loadReservationsForConsume(pid);
            else setConsumeProjectReservations([]);
          }}>
            <option value="">选择项目</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.project_code} / {p.project_name}</option>)}
          </select>
          <select value={consumeForm.reservationId} onChange={(e) => setConsumeForm({ ...consumeForm, reservationId: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">选择预留记录</option>
            {consumeProjectReservations.filter((r) => r.remaining_qty > 0).map((r) => (
              <option key={r.reservation_id} value={r.reservation_id}>#{r.reservation_id} / {r.sku} / 剩余 {r.remaining_qty}</option>
            ))}
          </select>
          <input type="number" placeholder="消耗数量" value={consumeForm.qty} onChange={(e) => setConsumeForm({ ...consumeForm, qty: e.target.value ? Number(e.target.value) : '' })} />
          <input placeholder="出库备注" value={consumeForm.note} onChange={(e) => setConsumeForm({ ...consumeForm, note: e.target.value })} />
          <button type="submit">提交</button>
        </form>
      </Modal>

      <Modal open={modal === 'project'} title="新增项目" onClose={() => setModal(null)}>
        <form className="form" onSubmit={(e) => {
          e.preventDefault();
          if (!projectForm.code.trim() || !projectForm.name.trim()) return setMsg('error', '项目编码和项目名称不能为空');
          if (!isPositive(projectForm.ownerId)) return setMsg('error', '请选择负责人');
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
          }, '项目创建成功');
        }}>
          <input placeholder="项目编码" value={projectForm.code} onChange={(e) => setProjectForm({ ...projectForm, code: e.target.value })} />
          <input placeholder="项目名称" value={projectForm.name} onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })} />
          <select value={projectForm.ownerId} onChange={(e) => setProjectForm({ ...projectForm, ownerId: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">选择负责人</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <input placeholder="备注" value={projectForm.note} onChange={(e) => setProjectForm({ ...projectForm, note: e.target.value })} />
          <button type="submit">提交</button>
        </form>
      </Modal>

      <Modal open={modal === 'member'} title="分配项目成员" onClose={() => setModal(null)}>
        <form className="form" onSubmit={(e) => {
          e.preventDefault();
          if (!selectedProjectId) return setMsg('error', '请先进入项目详情页');
          if (!isPositive(memberForm.userId) || !memberForm.projectRole.trim()) return setMsg('error', '请选择成员并填写项目角色');
          void runAction(async () => {
            await apiClient.addProjectMember(selectedProjectId, {
              user_id: toNum(memberForm.userId),
              project_role: memberForm.projectRole.trim(),
            });
            setMemberForm({ userId: '', projectRole: '成员' });
            await loadProjectDetail(selectedProjectId);
          }, '成员分配成功');
        }}>
          <input value={selectedProject?.project_code || ''} readOnly />
          <select value={memberForm.userId} onChange={(e) => setMemberForm({ ...memberForm, userId: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">选择用户</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}（{roleLabel(u.role)}）</option>)}
          </select>
          <input placeholder="项目角色" value={memberForm.projectRole} onChange={(e) => setMemberForm({ ...memberForm, projectRole: e.target.value })} />
          <button type="submit">提交</button>
        </form>
      </Modal>

      <Modal open={modal === 'commit'} title="提交项目 Commit" onClose={() => setModal(null)}>
        <form className="form" onSubmit={(e) => {
          e.preventDefault();
          if (!selectedProjectId) return setMsg('error', '请先进入项目详情页');
          if (!commitForm.title.trim() || !commitForm.content.trim()) return setMsg('error', '标题和内容不能为空');
          void runAction(async () => {
            await apiClient.createProjectCommit(selectedProjectId, {
              title: commitForm.title.trim(),
              content: commitForm.content.trim(),
              status_to: commitForm.statusTo,
              progress_pct: Number(commitForm.progress),
            });
            setCommitForm({ title: '', content: '', statusTo: 'active', progress: 0 });
            await loadBase();
            await loadProjectDetail(selectedProjectId);
          }, 'Commit 提交成功');
        }}>
          <input value={selectedProject?.project_code || ''} readOnly />
          <input placeholder="标题" value={commitForm.title} onChange={(e) => setCommitForm({ ...commitForm, title: e.target.value })} />
          <textarea placeholder="内容" value={commitForm.content} onChange={(e) => setCommitForm({ ...commitForm, content: e.target.value })} />
          <div className="row2">
            <select value={commitForm.statusTo} onChange={(e) => setCommitForm({ ...commitForm, statusTo: e.target.value as (typeof projectStatusOptions)[number] })}>
              {projectStatusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input type="number" min={0} max={100} value={commitForm.progress} onChange={(e) => setCommitForm({ ...commitForm, progress: Number(e.target.value) })} />
          </div>
          <button type="submit">提交</button>
        </form>
      </Modal>

      <Modal open={modal === 'user'} title="新增用户" onClose={() => setModal(null)}>
        <form className="form" onSubmit={(e) => {
          e.preventDefault();
          if (!userForm.email.trim() || !userForm.name.trim() || !userForm.password.trim()) return setMsg('error', '请填写完整用户信息');
          void runAction(async () => {
            await apiClient.createUser({
              email: userForm.email.trim(),
              name: userForm.name.trim(),
              password: userForm.password,
              role: userForm.role,
            });
            setUserForm({ email: '', name: '', password: '', role: 'visitor' });
            await loadBase();
          }, '用户创建成功');
        }}>
          <input placeholder="邮箱" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} />
          <input placeholder="姓名" value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })} />
          <input type="password" placeholder="密码" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} />
          <select value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value as 'admin' | 'visitor' })}>
            <option value="visitor">访客</option>
            <option value="admin">管理员</option>
          </select>
          <button type="submit">提交</button>
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
        <option value="">选择 SKU</option>
        {products.map((p) => <option key={p.id} value={p.id}>{p.sku} / {p.name}</option>)}
      </select>
      <input type="number" placeholder="数量" value={state.qty} onChange={(e) => setState({ ...state, qty: e.target.value ? Number(e.target.value) : '' })} />
      <input placeholder="备注" value={state.reason} onChange={(e) => setState({ ...state, reason: e.target.value })} />
      <button type="submit">提交</button>
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
          <button className="close-btn" onClick={onClose}>关闭</button>
        </div>
        {children}
      </div>
    </div>
  );
}
