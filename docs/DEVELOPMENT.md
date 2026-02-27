# 开发文档

## 1. 技术栈
- 前端：Vite + React + TypeScript
- 后端：Cloudflare Workers + Hono + D1
- 认证：JWT（Bearer Token）

## 2. 业务规则（当前版本）
- 单仓模型。
- 角色仅两类：`admin`、`visitor`。
- `admin` 拥有全部写权限；`visitor` 只读（项目 Commit 需为项目成员）。
- 项目消耗必须先预留，不能绕过预留直接消耗。
- 库存口径完整：总库存、在途、在手、可用、预留、已消耗、安全库存、缺口。

## 3. 页面信息架构（Web）
- `SKU主数据`：仅展示 SKU 主数据（SKU 编号、分类、型号/规格、单位、安全库存、状态），不展示库存数量。
- `库存`：仅展示库存口径列表；点击 SKU 进入详情页，查看 SKU 信息 + 库存流水。
- `项目`：仅展示项目列表；点击项目进入详情页，查看成员、预留库存、Commit 记录。
- `用户`（仅管理员）：用户创建与账号停用（软删除）。

## 4. 删除策略（已实现）
- 删除 SKU：`DELETE /api/products/:id`
  - 同步删除 SKU 相关库存流水、预留/消耗记录、库存余额、项目物料计划等关联数据。
- 删除项目：`DELETE /api/projects/:id`
  - 先自动释放该项目未消耗预留量回可用库存，再删除项目及其成员、Commit、预留/消耗等关联数据。
- 删除用户：`DELETE /api/users/:id`
  - 软删除，不物理删行。
  - 清空登录凭据（邮箱替换为删除占位、密码置换）、状态置为 `inactive`。
  - 历史项目参与和 Commit 记录可继续显示。

## 5. 后端 API（核心）
- 鉴权：
  - `POST /api/auth/login`
  - `GET /api/auth/me`
- 用户：
  - `GET /api/users`
  - `POST /api/users`
  - `PUT /api/users/:id/role`
  - `DELETE /api/users/:id`
- 分类与 SKU：
  - `GET/POST /api/categories`
  - `GET/POST /api/products`
  - `DELETE /api/products/:id`
- 项目：
  - `GET/POST /api/projects`
  - `DELETE /api/projects/:id`
  - `GET /api/projects/:id/members`
  - `POST /api/projects/:id/members`
  - `GET /api/projects/:id/commits`
  - `POST /api/projects/:id/commits`
  - `GET /api/projects/:id/reservations`
- 库存：
  - `GET /api/inventory/summary`
  - `GET /api/inventory/transactions?product_id=&limit=`
  - `POST /api/inventory/inbound`
  - `POST /api/inventory/transit/create`
  - `POST /api/inventory/transit/receive`
  - `POST /api/inventory/reserve`
  - `POST /api/inventory/consume`
  - `POST /api/inventory/release`

## 6. 本地开发
1. 安装依赖：`npm install`
2. 执行迁移：`npm run d1:migrate --workspace @am-manager/worker`
3. 启动后端：`npm run dev:worker`
4. 启动前端：`npm run dev:web`
5. 访问：`http://localhost:5173`

## 7. 部署
1. Worker：`npm run deploy --workspace @am-manager/worker`
2. Web：推送 `main` 分支后由 GitHub Actions 自动构建并发布到 GitHub Pages。

## 8. 已验证项（2026-02-27）
- 前端构建通过：`npm run build --workspace @am-manager/web`
- Worker 构建通过：`npm run build --workspace @am-manager/worker`
- 线上冒烟测试通过：
  - 项目删除会释放预留库存。
  - 用户删除为软删除并保留历史。
  - SKU 删除后数据不可再查询。
