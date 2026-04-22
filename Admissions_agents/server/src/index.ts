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

const app = express();

app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ success: true, data: { service: 'admissions-server' }, error: null });
});

app.use('/api/health', healthRouter);
app.use('/api/leads', leadsRouter);
app.use('/api/ai', aiRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/students', studentsRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/content', contentRouter);
app.use('/api/schools', schoolsRouter);
app.use('/api', materialsRouter);
app.use('/api/courses', coursesRouter);
app.use('/api/schedule', scheduleRouter);

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
