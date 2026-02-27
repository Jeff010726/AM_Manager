# AM Manager

轻量级 ERP（项目管理 + 库存管理）MVP。

## 目录结构
- `apps/web`: 前端（Vite + React），用于 GitHub Pages 静态部署。
- `apps/worker`: 后端（Cloudflare Worker + D1）。
- `docs`: 开发与使用文档。

## 快速开始
1. 安装依赖
```bash
npm install
```

2. 配置 Worker（`apps/worker/wrangler.toml`）
- 填入 `database_id`
- 设置 `name`

3. 配置本地密钥（`apps/worker/.dev.vars`）
```env
JWT_SECRET=replace_with_strong_secret
CORS_ORIGIN=http://localhost:5173
```

4. 初始化数据库
```bash
npm run d1:migrate --workspace @am-manager/worker
```

5. 启动后端
```bash
npm run dev:worker
```

6. 启动前端
```bash
npm run dev:web
```

7. 默认账号
- admin: `admin@example.com` / `admin123`
- visitor: `visitor@example.com` / `visitor123`

## 部署
- 前端：构建后发布到 GitHub Pages。
- 后端：
```bash
npm run deploy:worker
```

### 线上地址
- 后端 API：`https://am-manager-api.am-manager.workers.dev`
- 前端 Pages（部署后）：`https://jeff010726.github.io/AM_Manager/`

详见：
- `docs/DEVELOPMENT.md`
- `docs/USER_GUIDE.md`
