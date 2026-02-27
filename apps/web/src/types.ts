export type Role = 'admin' | 'visitor';
export type ProjectStatus = 'planned' | 'active' | 'blocked' | 'done' | 'cancelled';

export type LoginResponse = {
  token: string;
  user: {
    id: number;
    email: string;
    name: string;
    role: Role;
  };
};

export type User = {
  id: number;
  email: string;
  name: string;
  role: Role;
  status: string;
};

export type Category = {
  id: number;
  name: string;
  parent_id: number | null;
};

export type Product = {
  id: number;
  sku: string;
  name: string;
  category_id: number;
  category_name: string;
  unit: string;
  spec?: string | null;
  status: string;
  safety_stock_qty: number;
  total_stock_qty: number;
  in_transit_qty: number;
  on_hand_qty: number;
  available_qty: number;
  reserved_qty: number;
  consumed_qty: number;
  shortage_qty: number;
};

export type Project = {
  id: number;
  project_code: string;
  project_name: string;
  status: ProjectStatus;
  owner_user_id: number;
  owner_name: string;
  start_date?: string | null;
  end_date?: string | null;
  note?: string | null;
};

export type ProjectMember = {
  user_id: number;
  name: string;
  email: string;
  system_role: Role;
  project_role: string;
  joined_at: string;
  last_commit_at?: string | null;
};

export type ProjectCommit = {
  commit_id: number;
  project_id: number;
  seq_no: number;
  author_user_id: number;
  author_name: string;
  author_email: string;
  author_system_role: Role;
  author_project_role: string;
  title: string;
  content: string;
  status_from: ProjectStatus;
  status_to: ProjectStatus;
  progress_pct?: number | null;
  created_at: string;
};

export type ProjectReservation = {
  reservation_id: number;
  project_id: number;
  product_id: number;
  sku: string;
  product_name: string;
  unit: string;
  qty: number;
  consumed_qty: number;
  released_qty: number;
  remaining_qty: number;
  status: string;
  created_at: string;
  updated_at: string;
};

export type InventoryItem = {
  product_id: number;
  sku: string;
  name: string;
  unit: string;
  safety_stock_qty: number;
  total_stock_qty: number;
  in_transit_qty: number;
  on_hand_qty: number;
  available_qty: number;
  reserved_qty: number;
  consumed_qty: number;
  shortage_qty: number;
};

export type InventoryTransaction = {
  id: number;
  product_id: number;
  sku: string;
  product_name: string;
  operation_type: string;
  qty: number;
  delta_on_hand: number;
  delta_in_transit: number;
  delta_reserved: number;
  delta_consumed: number;
  project_id: number | null;
  project_code?: string | null;
  project_name?: string | null;
  reservation_id: number | null;
  reason?: string | null;
  actor_user_id: number;
  actor_name: string;
  idempotency_key: string;
  request_id: string;
  created_at: string;
};

export type ApiEnvelope<T> = {
  success: boolean;
  data: T;
  error_code?: string;
  message?: string;
};
