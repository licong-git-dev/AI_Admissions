# 落地执行文档索引

> 这一层是 Product Spec 的「动词」部分：部署、运维、推广、合规。
> 代码完整度见 [../Product-Spec.md](../Product-Spec.md)，版本迭代见 [../Product-Spec-CHANGELOG.md](../Product-Spec-CHANGELOG.md)。

---

## 🚀 立刻上线（部署路径）

| 文档 | 干什么用 |
|------|---------|
| [../DEPLOY-QUICKSTART.md](../DEPLOY-QUICKSTART.md) | **从 0 开始部署一页纸**：5 步跑起来（拉代码 → 配 .env → docker compose up → 改密码 → 建租户） |
| [Post-Deploy-24h-Checklist.md](./Post-Deploy-24h-Checklist.md) | 部署后 24h 自检：T+0 / T+2 / T+6 / T+12 / T+24 五时点、红线指标、通过清单 |
| [Operator-Runbook.md](./Operator-Runbook.md) | 日常运维手册：监控口径、常见故障排查、备份/恢复流程 |
| [Zero-Touch-Operations.md](./Zero-Touch-Operations.md) | 零人力运营方案：三档运营（谨慎 15 min / 平衡 5 min / 激进 2 min）、紧急刹车、月度健康度 |

## 📣 招生冷启动（MVP 验证）

新租户第一个 14 天用这套节奏跑，**先 MVP 再投自动化**。系统已就绪，但学员来源还是靠内容+顾问，不要跳过验证。

| 文档 | 干什么用 |
|------|---------|
| [MVP-XHS-14days.md](./MVP-XHS-14days.md) | 14 天小红书单平台主方案（3 账号矩阵 + Go/No-Go 决策门） |
| [MVP-Content-Backlog.md](./MVP-Content-Backlog.md) | 15 条启动选题（标题、钩子、结构） |
| [MVP-Daily-SOP.md](./MVP-Daily-SOP.md) | 每日 1 小时操作清单 + 异常处理 |
| [MVP-Metrics-Template.csv](./MVP-Metrics-Template.csv) | 14 天 × 3 账号数据追踪表 |

**决策门（2 周后）**：

| 结果 | 门槛 | 下一步 |
|------|------|-------|
| ✅ Go | 线索 ≥ 20 条 + 爆款 ≥ 5000 浏览 + 加微率 ≥ 40% + 无限流 | 接入 RPA + 走法务 + 扩多平台 |
| 🟡 Yellow | 2/4 项在中间档 | 再跑 2 周调整选题，**不要**急着上自动化 |
| ❌ No-Go | 任一项落 No-Go | 换平台或换定位，不要沉没成本 |

## 🏗 架构与集成参考

| 文档 | 干什么用 |
|------|---------|
| [Agent-Architecture.md](./Agent-Architecture.md) | AI 数字员工（v3.0+）的架构：mission / step / tool / approval 的数据流 |
| [API-Reference.md](./API-Reference.md) | 后端所有 HTTP 接口的请求/响应契约 |
| [Competitive-Analysis.md](./Competitive-Analysis.md) | 竞品分析（SCRM / Manus / Cowork）+ 违规词库依据 |
| [User-Journey-Playbook.md](./User-Journey-Playbook.md) | 端到端用户旅程（从小红书看到帖子 → 到最终学员毕业）的完整剧本 |

---

## 对外和商务

- [../PITCH.md](../PITCH.md) — 一页纸对外口径（乙方合作 / 投资人介绍共用）
- [../Product-Spec-V3-Roadmap.md](../Product-Spec-V3-Roadmap.md) — v3+ 演进候选清单
- [../raw_data/](../raw_data/) — 合同原始材料（技术入股合作合同）

---

## 执行原则（不变的 5 条）

1. **先 MVP 再投入** — 最低成本测内容策略是否成立
2. **先跑通再优化** — 不要在部署阶段追求完美
3. **先人工再自动** — RPA/微信自动化风险高，先用 AI 生成 + 人工操作验证
4. **先单平台再多平台** — 一个平台打透再复制
5. **数据驱动决策** — 每周看指标，不凭感觉调整
