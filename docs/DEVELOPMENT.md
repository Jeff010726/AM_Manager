# 开发文档

## 1. 技术栈
- 前端：Vite + React + TypeScript
- 后端：Cloudflare Workers + Hono + D1
- 认证：JWT（Bearer Token）

## 2. 核心业务约束（已实现）
- 单仓模型
- 系统角色：`admin`、`visitor`
- 项目成员可提交 Commit（visitor 仅项目动态可写）
- 项目消耗必须先预留
- 库存口径齐全：总库存、在途、在库、可用、预留、消耗、安全库存、缺口

## 3. 数据库迁移
- 路径：`apps/worker/migrations/0001_init.sql`
- 执行：
```bash
npm run d1:migrate --workspace @am-manager/worker
```

## 4. 后端 API 概览
- 鉴权：
  - `POST /api/auth/login`
  - `GET /api/auth/me`
- 用户：
  - `GET /api/users`
  - `POST /api/users`
  - `PUT /api/users/:id/role`
- 主数据：
  - `GET/POST /api/categories`
  - `GET/POST /api/products`
- 项目：
  - `GET/POST /api/projects`
  - `GET /api/projects/:id/members`
  - `POST /api/projects/:id/members`
  - `GET /api/projects/:id/commits`
  - `POST /api/projects/:id/commits`
- 库存：
  - `GET /api/inventory/summary`
  - `POST /api/inventory/inbound`
  - `POST /api/inventory/transit/create`
  - `POST /api/inventory/transit/receive`
  - `POST /api/inventory/reserve`
  - `POST /api/inventory/consume`
  - `POST /api/inventory/release`
  - `POST /api/inventory/outbound`
  - `POST /api/inventory/adjust`

## 5. 前端联动页面
- 登录
- 库存总览与库存操作
- 项目列表、项目成员、Commit 时间线
- 主数据管理（分类、SKU）
- 用户管理（admin）

## 6. 本地联调流程
1. 启动 Worker：`npm run dev:worker`
2. 启动 Web：`npm run dev:web`
3. 浏览器访问 `http://localhost:5173`

## 7. 部署流程
1. Worker：`npm run deploy:worker`
2. Web：`npm run build:web`，将 `apps/web/dist` 发布到 GitHub Pages

## 8. 已知限制与后续建议
- 当前为 MVP，未实现完整审批流。
- 建议下一阶段补充：
  - 事务封装（跨多 SQL 的强一致写链路）
  - CSV 批量导入导出
  - 报表筛选与分页
  - 自动化测试（Vitest + Playwright）
