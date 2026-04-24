import express from 'express';
import { config } from './config';
import './db';
import { healthRouter } from './routes/health';
import { leadsRouter } from './routes/leads';
import { aiRouter } from './routes/ai';
import { dashboardRouter } from './routes/dashboard';
import { studentsRouter } from './routes/students';
import { paymentsRouter } from './routes/payments';
import { contentRouter } from './routes/content';
import { schoolsRouter } from './routes/schools';
import { materialsRouter } from './routes/materials';
import { coursesRouter } from './routes/courses';
import { scheduleRouter } from './routes/schedule';
import { rpaRouter } from './routes/rpa';
import { agreementsRouter } from './routes/agreements';
import { leadFormsRouter } from './routes/lead-forms';
import { violationWordsRouter } from './routes/violation-words';
import { crawlerRouter } from './routes/crawler';
import { depositsRouter } from './routes/deposits';
import { authRouter } from './routes/auth';
import { studentAuthRouter } from './routes/student-auth';
import { dealsRouter, settlementRouter } from './routes/deals';
import { auditRouter } from './routes/audit';
import { wechatWorkRouter } from './routes/wechat-work';
import { platformRouter } from './routes/platform';
import { metricsRouter } from './routes/metrics';
import { missionsRouter } from './routes/missions';
import { requireAuth, requireRole, type AuthedRequest } from './middleware/auth';
import { auditLog } from './middleware/audit';

const app = express();

app.use(express.json({ limit: '1mb' }));

app.get('/', (_req, res) => {
  res.json({ success: true, data: { service: 'admissions-server' }, error: null });
});

app.use('/api/health', healthRouter);
app.use('/api/metrics', metricsRouter);
app.use('/api/auth', authRouter);
app.use('/api/student', studentAuthRouter);

// 公开端点：H5 留资入口 + 支付下单 + 支付回调 + 学员查询订单 + 企业微信回调
app.use('/api/lead-forms', leadFormsRouter);
app.use('/api/deposits', depositsRouter);
app.use('/api/wechat-work', wechatWorkRouter);

// 从这里往下的所有 /api/** 路由需要登录 + 审计留痕
app.use('/api', (req, res, next) => {
  if (req.path === '' || req.path === '/') {
    return next();
  }
  return requireAuth(req as AuthedRequest, res, next);
});
app.use('/api', (req, res, next) => auditLog(req as AuthedRequest, res, next));

// 业务级路由：admin + tenant_admin + specialist 均可访问
app.use('/api/leads', leadsRouter);
app.use('/api/deals', dealsRouter);
app.use('/api/settlement', settlementRouter);
app.use('/api/ai', aiRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/students', studentsRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/content', contentRouter);
app.use('/api', materialsRouter);
app.use('/api/courses', coursesRouter);
app.use('/api/schedule', scheduleRouter);

// 管理级路由：仅 admin + tenant_admin
app.use('/api/schools', requireRole(['admin', 'tenant_admin']), schoolsRouter);
app.use('/api/rpa', requireRole(['admin', 'tenant_admin']), rpaRouter);
app.use('/api/violation-words', requireRole(['admin', 'tenant_admin']), violationWordsRouter);
app.use('/api/crawler', requireRole(['admin', 'tenant_admin']), crawlerRouter);

// 甲方级路由：仅 admin
app.use('/api/agreements', requireRole(['admin']), agreementsRouter);
app.use('/api/audit', auditRouter);
app.use('/api/platform', platformRouter);
app.use('/api/missions', missionsRouter);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const isDevelopment = config.nodeEnv === 'development';
  const message = isDevelopment && error instanceof Error ? error.message : 'Internal Server Error';
  res.status(500).json({ success: false, data: null, error: message });
});

app.use((_req, res) => {
  res.status(404).json({ success: false, data: null, error: 'Not Found' });
});

app.listen(config.port, () => {
  console.log(`[server] running on http://localhost:${config.port}`);
});
