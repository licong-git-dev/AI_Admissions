# 01 — 部署方案

## 系统架构

```
┌─────────────────────────────────────────────────┐
│                   用户浏览器                      │
│         (管理员 / 招生专员 / 学员)                 │
└──────────────────────┬──────────────────────────┘
                       │ HTTPS
┌──────────────────────▼──────────────────────────┐
│              Nginx 反向代理                       │
│         (SSL证书 + 静态文件托管)                   │
├─────────────────────────────────────────────────┤
│              React 前端 (Vite Build)              │
│         (管理后台 + 学员自助端)                    │
├─────────────────────────────────────────────────┤
│              后端 API (待开发)                     │
│         (Express/NestJS + PostgreSQL)             │
├─────────────────────────────────────────────────┤
│              Gemini API                           │
│         (内容生成 / 意向分析 / 话术推荐)           │
├─────────────────────────────────────────────────┤
│              RPA 引擎 (Phase 2)                   │
│         (Playwright + 定时任务)                    │
├─────────────────────────────────────────────────┤
│              企业微信 API (Phase 2)                │
│         (官方开放接口)                             │
└─────────────────────────────────────────────────┘
```

## 当前状态

你现在有的是一个**纯前端应用**（React + Vite），数据全是Mock。要真正上线，需要分两步走：

## Phase 1：最小可用版本（1-2周）

### 方案A：直接用 Google AI Studio 托管（最快）

如果你是在 AI Studio Builder 里创建的项目，可以直接用 Google 提供的托管：

1. 在 AI Studio Builder 中点击 "Deploy"
2. Google 会自动部署到 Cloud Run
3. 你会得到一个 `https://xxx.run.app` 的访问地址
4. 配置自定义域名（可选）

**优点**：零运维，Google 帮你搞定一切
**缺点**：数据不在你手里，后续定制受限

### 方案B：自己部署到云服务器（推荐）

**第一步：买服务器**

| 选项 | 推荐 | 月费 | 说明 |
|------|------|------|------|
| 阿里云 ECS | 2核4G | ~100元/月 | 国内访问快，备案方便 |
| 腾讯云轻量 | 2核4G | ~60元/月 | 性价比高，适合初期 |
| Vercel | 免费套餐 | 0元 | 只能托管前端，不能跑后端 |

**推荐**：腾讯云轻量 2核4G，先用最便宜的，跑通再升级。

**第二步：部署前端**

```bash
# 1. 本地打包
cd Admissions_agents
npm run build

# 2. 上传 dist 目录到服务器
scp -r dist/ root@your-server-ip:/var/www/admissions/

# 3. 服务器上配置 Nginx
# /etc/nginx/sites-available/admissions
server {
    listen 80;
    server_name your-domain.com;
    root /var/www/admissions;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}

# 4. 配置SSL证书（用 Let's Encrypt 免费证书）
sudo certbot --nginx -d your-domain.com
```

**第三步：域名和备案**

1. 买个域名（阿里云/腾讯云，几十块一年）
2. 国内服务器必须备案（腾讯云有快速备案通道，约2周）
3. 备案期间可以先用IP地址访问

### 方案C：Vercel 部署前端 + 云函数（折中）

```bash
# 1. 安装 Vercel CLI
npm i -g vercel

# 2. 一键部署
cd Admissions_agents
vercel

# 3. 自动获得 https://xxx.vercel.app 地址
```

**优点**：免费，秒部署，自动HTTPS
**缺点**：海外服务器，国内访问可能慢；不能备案

## Phase 2：完整后端（2-4周）

当前系统是纯前端+Gemini API，没有数据库。你需要逐步加上：

### 需要开发的后端功能

| 功能 | 技术方案 | 优先级 |
|------|---------|--------|
| 用户认证（登录） | JWT Token + bcrypt | P0 |
| 学员数据CRUD | Express + PostgreSQL | P0 |
| 缴费记录管理 | Express + PostgreSQL | P0 |
| 排课数据管理 | Express + PostgreSQL | P1 |
| 内容审核队列 | Express + PostgreSQL | P1 |
| 企业微信接入 | 企业微信官方SDK | P2 |
| RPA发布引擎 | Playwright + node-cron | P3 |
| 个人微信辅助 | WeChatFerry（高风险） | P3 |

### 数据库设计（核心表）

```sql
-- 用户表
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50),
    password_hash VARCHAR(255),
    role VARCHAR(20), -- admin / specialist / student
    name VARCHAR(100),
    phone VARCHAR(20),
    created_at TIMESTAMP DEFAULT NOW()
);

-- 学员表
CREATE TABLE students (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    phone VARCHAR(20),
    wechat VARCHAR(100),
    education VARCHAR(50),
    job VARCHAR(100),
    major VARCHAR(100),
    source VARCHAR(50),
    status VARCHAR(20),
    assignee_id INTEGER REFERENCES users(id),
    tags TEXT[],
    created_at TIMESTAMP DEFAULT NOW()
);

-- 缴费记录表
CREATE TABLE payments (
    id SERIAL PRIMARY KEY,
    student_id INTEGER REFERENCES students(id),
    amount DECIMAL(10,2),
    method VARCHAR(50),
    installment_no INTEGER,
    total_installments INTEGER,
    paid_at TIMESTAMP,
    note TEXT
);

-- 内容表
CREATE TABLE contents (
    id SERIAL PRIMARY KEY,
    title VARCHAR(500),
    content TEXT,
    type VARCHAR(50),
    platform VARCHAR(50),
    status VARCHAR(20), -- draft / pending / approved / published
    published_at TIMESTAMP,
    stats JSONB,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW()
);

-- 线索表
CREATE TABLE leads (
    id SERIAL PRIMARY KEY,
    source VARCHAR(50),
    nickname VARCHAR(100),
    intent VARCHAR(20),
    messages JSONB,
    status VARCHAR(20),
    assignee_id INTEGER REFERENCES users(id),
    ai_analysis JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);
```

## 环境变量配置

```bash
# .env 文件（不要提交到git）

# Gemini API
GEMINI_API_KEY=your_gemini_api_key_here

# 数据库（Phase 2）
DATABASE_URL=postgresql://user:pass@localhost:5432/admissions

# JWT密钥（Phase 2）
JWT_SECRET=your_random_secret_here

# 企业微信（Phase 2）
WECHAT_CORP_ID=your_corp_id
WECHAT_CORP_SECRET=your_corp_secret
WECHAT_AGENT_ID=your_agent_id
```

## Gemini API Key 获取

1. 访问 https://aistudio.google.com/apikey
2. 点击 "Create API Key"
3. 选择一个 Google Cloud 项目（没有就新建）
4. 复制 API Key 到 `.env` 文件
5. 免费额度：每分钟15次请求，每天1500次，够初期用

## 部署检查清单

- [ ] 服务器/托管平台已准备
- [ ] 域名已购买
- [ ] 备案已提交（国内服务器）
- [ ] Gemini API Key 已配置
- [ ] HTTPS 已启用
- [ ] .env 文件已配置且不在git中
- [ ] 前端已打包部署
- [ ] 访问地址可正常打开
- [ ] AI内容生成功能可正常使用
