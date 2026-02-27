import type {
  ApiEnvelope,
  Category,
  InventoryItem,
  InventoryTransaction,
  LoginResponse,
  Product,
  Project,
  ProjectCommit,
  ProjectMember,
  ProjectReservation,
  Role,
  User,
} from './types';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8787';

export class ApiClient {
  private token: string | null;

  constructor(token?: string | null) {
    this.token = token || null;
  }

  setToken(token: string | null) {
    this.token = token;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string>),
    };

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
    });

    const json = (await res.json()) as ApiEnvelope<T>;
    if (!res.ok || !json.success) {
      throw new Error(json.message || json.error_code || `HTTP ${res.status}`);
    }
    return json.data;
  }

  login(email: string, password: string) {
    return this.request<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  me() {
    return this.request<User>('/api/auth/me');
  }

  listUsers() {
    return this.request<User[]>('/api/users');
  }

  createUser(payload: { email: string; name: string; password: string; role: Role }) {
    return this.request<{ id: number }>('/api/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  deleteUser(userId: number) {
    return this.request<{ id: number; status: string }>(`/api/users/${userId}`, {
      method: 'DELETE',
    });
  }

  listCategories() {
    return this.request<Category[]>('/api/categories');
  }

  createCategory(payload: { name: string; parent_id?: number | null }) {
    return this.request<{ id: number }>('/api/categories', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  deleteCategory(categoryId: number) {
    return this.request<{ id: number; deleted_category_count: number; deleted_product_count: number }>(`/api/categories/${categoryId}`, {
      method: 'DELETE',
    });
  }

  listProducts(q = '') {
    const query = q ? `?q=${encodeURIComponent(q)}` : '';
    return this.request<Product[]>(`/api/products${query}`);
  }

  createProduct(payload: {
    sku: string;
    name: string;
    category_id: number;
    unit: string;
    spec?: string;
    safety_stock_qty: number;
    status: 'active' | 'inactive';
  }) {
    return this.request<{ id: number }>('/api/products', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  deleteProduct(productId: number) {
    return this.request<{ id: number }>(`/api/products/${productId}`, {
      method: 'DELETE',
    });
  }

  listProjects() {
    return this.request<Project[]>('/api/projects');
  }

  createProject(payload: {
    project_code: string;
    project_name: string;
    owner_user_id: number;
    status: 'planned' | 'active' | 'blocked' | 'done' | 'cancelled';
    note?: string;
  }) {
    return this.request<{ id: number }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  deleteProject(projectId: number) {
    return this.request<{ id: number }>(`/api/projects/${projectId}`, {
      method: 'DELETE',
    });
  }

  listProjectMembers(projectId: number) {
    return this.request<ProjectMember[]>(`/api/projects/${projectId}/members`);
  }

  addProjectMember(projectId: number, payload: { user_id: number; project_role: string }) {
    return this.request(`/api/projects/${projectId}/members`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  listProjectCommits(projectId: number) {
    return this.request<ProjectCommit[]>(`/api/projects/${projectId}/commits`);
  }

  listProjectReservations(projectId: number) {
    return this.request<ProjectReservation[]>(`/api/projects/${projectId}/reservations`);
  }

  createProjectCommit(
    projectId: number,
    payload: {
      title: string;
      content: string;
      status_to: 'planned' | 'active' | 'blocked' | 'done' | 'cancelled';
      progress_pct?: number;
    },
  ) {
    return this.request(`/api/projects/${projectId}/commits`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  updateProjectCommit(
    projectId: number,
    commitId: number,
    payload: {
      title: string;
      content: string;
      status_to: 'planned' | 'active' | 'blocked' | 'done' | 'cancelled';
      progress_pct?: number;
    },
  ) {
    return this.request(`/api/projects/${projectId}/commits/${commitId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  listInventorySummary() {
    return this.request<InventoryItem[]>('/api/inventory/summary');
  }

  listInventoryTransactions(productId?: number, limit = 500) {
    const parts: string[] = [];
    if (productId) parts.push(`product_id=${encodeURIComponent(String(productId))}`);
    if (limit > 0) parts.push(`limit=${encodeURIComponent(String(limit))}`);
    const query = parts.length ? `?${parts.join('&')}` : '';
    return this.request<InventoryTransaction[]>(`/api/inventory/transactions${query}`);
  }

  reserve(payload: { project_id: number; product_id: number; qty: number; reason?: string }) {
    return this.request('/api/inventory/reserve', {
      method: 'POST',
      body: JSON.stringify({ ...payload, idempotency_key: crypto.randomUUID() }),
    });
  }

  consume(payload: { reservation_id: number; qty: number; note?: string }) {
    return this.request('/api/inventory/consume', {
      method: 'POST',
      body: JSON.stringify({ ...payload, idempotency_key: crypto.randomUUID() }),
    });
  }

  inbound(payload: { product_id: number; qty: number; reason?: string }) {
    return this.request('/api/inventory/inbound', {
      method: 'POST',
      body: JSON.stringify({ ...payload, idempotency_key: crypto.randomUUID() }),
    });
  }

  outbound(payload: { product_id: number; qty: number; reason?: string }) {
    return this.request('/api/inventory/outbound', {
      method: 'POST',
      body: JSON.stringify({ ...payload, idempotency_key: crypto.randomUUID() }),
    });
  }

  transitCreate(payload: { product_id: number; qty: number; reason?: string }) {
    return this.request('/api/inventory/transit/create', {
      method: 'POST',
      body: JSON.stringify({ ...payload, idempotency_key: crypto.randomUUID() }),
    });
  }

  transitReceive(payload: { product_id: number; qty: number; reason?: string }) {
    return this.request('/api/inventory/transit/receive', {
      method: 'POST',
      body: JSON.stringify({ ...payload, idempotency_key: crypto.randomUUID() }),
    });
  }

  release(payload: { reservation_id: number; qty: number; reason?: string }) {
    return this.request('/api/inventory/release', {
      method: 'POST',
      body: JSON.stringify({ ...payload, idempotency_key: crypto.randomUUID() }),
    });
  }
}

export const apiClient = new ApiClient(localStorage.getItem('am_token'));
