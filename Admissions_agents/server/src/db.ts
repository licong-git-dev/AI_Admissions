import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from './config';
import { hashPassword } from './services/password';

const ensureDbDirectory = (dbPath: string): void => {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

ensureDbDirectory(config.dbPath);

export const db = new Database(config.dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    nickname TEXT NOT NULL,
    contact TEXT,
    intent TEXT NOT NULL DEFAULT 'low',
    last_message TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new',
    assignee TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS followups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL,
    channel TEXT NOT NULL,
    content TEXT NOT NULL,
    next_action TEXT,
    next_followup_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (lead_id) REFERENCES leads (id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS ai_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER,
    scene TEXT NOT NULL,
    input_payload TEXT NOT NULL,
    output_payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS enrollments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL UNIQUE,
    school_name TEXT,
    major_name TEXT,
    stage TEXT NOT NULL DEFAULT 'consulting',
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (lead_id) REFERENCES leads (id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS payment_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL,
    total_amount REAL NOT NULL DEFAULT 0,
    paid_amount REAL NOT NULL DEFAULT 0,
    method TEXT NOT NULL DEFAULT '全款',
    first_paid_at TEXT,
    next_payment_due_at TEXT,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (lead_id) REFERENCES leads (id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS proposal_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL UNIQUE,
    school_name TEXT NOT NULL DEFAULT '',
    major_name TEXT NOT NULL DEFAULT '',
    duration TEXT NOT NULL DEFAULT '',
    tuition_amount REAL NOT NULL DEFAULT 0,
    service_amount REAL NOT NULL DEFAULT 0,
    total_amount REAL NOT NULL DEFAULT 0,
    payment_method TEXT NOT NULL DEFAULT '全款',
    installments_note TEXT,
    suitable_for TEXT,
    risk_note TEXT,
    proposal_text TEXT NOT NULL DEFAULT '',
    copy_text TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (lead_id) REFERENCES leads (id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS content_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    platforms_json TEXT NOT NULL,
    body_json TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    reject_reason TEXT,
    generated_at TEXT NOT NULL DEFAULT (datetime('now')),
    published_at TEXT,
    views INTEGER NOT NULL DEFAULT 0,
    likes INTEGER NOT NULL DEFAULT 0,
    comments INTEGER NOT NULL DEFAULT 0,
    leads INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS schools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    level TEXT,
    admission_types_json TEXT NOT NULL DEFAULT '[]',
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS school_majors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    fee REAL NOT NULL DEFAULT 0,
    duration TEXT NOT NULL DEFAULT '',
    pass_rate TEXT NOT NULL DEFAULT '',
    requirements TEXT,
    advantages TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    UNIQUE(school_id, name)
  );

  CREATE TABLE IF NOT EXISTS student_materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    uploaded_at TEXT,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (lead_id) REFERENCES leads (id) ON DELETE CASCADE,
    UNIQUE(lead_id, name)
  );

  CREATE TABLE IF NOT EXISTS courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    major TEXT NOT NULL,
    teacher TEXT NOT NULL,
    time TEXT NOT NULL,
    date TEXT NOT NULL,
    location TEXT NOT NULL,
    students INTEGER NOT NULL DEFAULT 0,
    batch TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS attendance_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_name TEXT NOT NULL,
    course_name TEXT NOT NULL,
    date TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS agreements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    version TEXT NOT NULL,
    content TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(type, version)
  );

  CREATE TABLE IF NOT EXISTS consents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    agreement_id INTEGER NOT NULL,
    ip TEXT,
    ua TEXT,
    checked_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (agreement_id) REFERENCES agreements (id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS rpa_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    nickname TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'persona',
    cookies_json TEXT,
    device_fingerprint TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    daily_quota INTEGER NOT NULL DEFAULT 5,
    followers INTEGER NOT NULL DEFAULT 0,
    last_published_at TEXT,
    risk_note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(platform, nickname)
  );

  CREATE TABLE IF NOT EXISTS rpa_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    scheduled_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    result_json TEXT,
    started_at TEXT,
    finished_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (account_id) REFERENCES rpa_accounts (id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS rpa_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    platform_msg_id TEXT,
    sender_nickname TEXT NOT NULL,
    content TEXT NOT NULL,
    msg_type TEXT NOT NULL DEFAULT 'dm',
    fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
    processed_status TEXT NOT NULL DEFAULT 'pending',
    lead_id INTEGER,
    FOREIGN KEY (account_id) REFERENCES rpa_accounts (id) ON DELETE CASCADE,
    FOREIGN KEY (lead_id) REFERENCES leads (id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS crawler_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    domain TEXT NOT NULL,
    type TEXT NOT NULL,
    frequency_hours INTEGER NOT NULL DEFAULT 24,
    is_enabled INTEGER NOT NULL DEFAULT 1,
    last_crawled_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(domain, type)
  );

  CREATE TABLE IF NOT EXISTS crawler_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    summary TEXT,
    crawled_at TEXT NOT NULL DEFAULT (datetime('now')),
    fed_to_factory_at TEXT,
    UNIQUE(source_id, url),
    FOREIGN KEY (source_id) REFERENCES crawler_sources (id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS lead_forms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    fields_json TEXT NOT NULL,
    agreement_id INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (agreement_id) REFERENCES agreements (id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    scheduled_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    last_error TEXT,
    result_json TEXT,
    started_at TEXT,
    finished_at TEXT,
    singleton_key TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS agent_schedule_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant TEXT NOT NULL DEFAULT 'default',
    mission_type TEXT NOT NULL,
    cron_hour INTEGER NOT NULL DEFAULT 9,
    cron_weekday TEXT,
    enabled INTEGER NOT NULL DEFAULT 0,
    last_triggered_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(tenant, mission_type)
  );

  CREATE TABLE IF NOT EXISTS agent_missions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant TEXT NOT NULL DEFAULT 'default',
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    goal_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'queued',
    created_by INTEGER,
    step_count INTEGER NOT NULL DEFAULT 0,
    approval_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    summary TEXT,
    started_at TEXT,
    finished_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS agent_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mission_id INTEGER NOT NULL,
    step_index INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT,
    tool_name TEXT,
    tool_args_json TEXT,
    tool_result_json TEXT,
    needs_approval INTEGER NOT NULL DEFAULT 0,
    approved_by INTEGER,
    approved_at TEXT,
    rejected_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (mission_id) REFERENCES agent_missions (id) ON DELETE CASCADE,
    FOREIGN KEY (approved_by) REFERENCES users (id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS student_otp_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    consumed_at TEXT,
    ip TEXT,
    ua TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'specialist',
    phone TEXT,
    wechat_work_userid TEXT,
    tenant TEXT NOT NULL DEFAULT 'default',
    is_active INTEGER NOT NULL DEFAULT 1,
    last_login_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS deals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL,
    school_name TEXT NOT NULL,
    major_name TEXT NOT NULL,
    total_tuition INTEGER NOT NULL,
    commission_rate REAL NOT NULL DEFAULT 0.30,
    commission_amount INTEGER NOT NULL,
    deposit_id INTEGER,
    tenant TEXT NOT NULL DEFAULT 'default',
    assignee_user_id INTEGER,
    status TEXT NOT NULL DEFAULT 'pending_payment',
    paid_amount INTEGER NOT NULL DEFAULT 0,
    commission_paid_amount INTEGER NOT NULL DEFAULT 0,
    commission_settled_at TEXT,
    signed_at TEXT NOT NULL DEFAULT (datetime('now')),
    note TEXT,
    suspicious INTEGER NOT NULL DEFAULT 0,
    suspicious_reason TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (lead_id) REFERENCES leads (id) ON DELETE RESTRICT,
    FOREIGN KEY (deposit_id) REFERENCES deposits (id) ON DELETE SET NULL,
    FOREIGN KEY (assignee_user_id) REFERENCES users (id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS settlement_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period TEXT NOT NULL UNIQUE,
    tenant TEXT NOT NULL DEFAULT 'default',
    total_deals INTEGER NOT NULL DEFAULT 0,
    total_tuition INTEGER NOT NULL DEFAULT 0,
    total_commission INTEGER NOT NULL DEFAULT 0,
    commission_paid INTEGER NOT NULL DEFAULT 0,
    commission_unpaid INTEGER NOT NULL DEFAULT 0,
    suspicious_deals INTEGER NOT NULL DEFAULT 0,
    generated_at TEXT NOT NULL DEFAULT (datetime('now')),
    generated_by INTEGER,
    FOREIGN KEY (generated_by) REFERENCES users (id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    role TEXT,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    before_json TEXT,
    after_json TEXT,
    ip TEXT,
    ua TEXT,
    status_code INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS deposits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER,
    out_trade_no TEXT NOT NULL UNIQUE,
    amount INTEGER NOT NULL DEFAULT 50000,
    currency TEXT NOT NULL DEFAULT 'CNY',
    description TEXT NOT NULL DEFAULT '招生平台学员报名意向定金',
    status TEXT NOT NULL DEFAULT 'pending',
    code_url TEXT,
    transaction_id TEXT,
    payer_openid TEXT,
    paid_at TEXT,
    refund_no TEXT,
    refund_amount INTEGER NOT NULL DEFAULT 0,
    refund_reason TEXT,
    refunded_at TEXT,
    meta_json TEXT,
    phone TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (lead_id) REFERENCES leads (id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS violation_words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT NOT NULL UNIQUE,
    severity TEXT NOT NULL DEFAULT 'block',
    reason TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS lead_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    form_id INTEGER NOT NULL,
    phone TEXT NOT NULL,
    answers_json TEXT NOT NULL,
    report_json TEXT,
    lead_id INTEGER,
    consent_id INTEGER NOT NULL,
    ip TEXT,
    ua TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (form_id) REFERENCES lead_forms (id) ON DELETE RESTRICT,
    FOREIGN KEY (lead_id) REFERENCES leads (id) ON DELETE SET NULL,
    FOREIGN KEY (consent_id) REFERENCES consents (id) ON DELETE RESTRICT
  );

  CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
  CREATE INDEX IF NOT EXISTS idx_followups_lead_id ON followups(lead_id);
  CREATE INDEX IF NOT EXISTS idx_payment_records_lead_id ON payment_records(lead_id);
  CREATE INDEX IF NOT EXISTS idx_proposal_cards_lead_id ON proposal_cards(lead_id);
  CREATE INDEX IF NOT EXISTS idx_content_items_status ON content_items(status);
  CREATE INDEX IF NOT EXISTS idx_school_majors_school_id ON school_majors(school_id);
  CREATE INDEX IF NOT EXISTS idx_student_materials_lead_id ON student_materials(lead_id);
  CREATE INDEX IF NOT EXISTS idx_courses_major ON courses(major);
  CREATE INDEX IF NOT EXISTS idx_attendance_records_date ON attendance_records(date);
  CREATE INDEX IF NOT EXISTS idx_rpa_tasks_status_scheduled ON rpa_tasks(status, scheduled_at);
  CREATE INDEX IF NOT EXISTS idx_rpa_tasks_account_id ON rpa_tasks(account_id);
  CREATE INDEX IF NOT EXISTS idx_rpa_messages_account_id ON rpa_messages(account_id);
  CREATE INDEX IF NOT EXISTS idx_rpa_messages_processed_status ON rpa_messages(processed_status);
  CREATE INDEX IF NOT EXISTS idx_consents_phone ON consents(phone);
  CREATE INDEX IF NOT EXISTS idx_crawler_items_source_id ON crawler_items(source_id);
  CREATE INDEX IF NOT EXISTS idx_lead_submissions_form_id ON lead_submissions(form_id);
  CREATE INDEX IF NOT EXISTS idx_deposits_lead_id ON deposits(lead_id);
  CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits(status);
  CREATE INDEX IF NOT EXISTS idx_deals_status ON deals(status);
  CREATE INDEX IF NOT EXISTS idx_deals_tenant ON deals(tenant);
  CREATE INDEX IF NOT EXISTS idx_deals_lead_id ON deals(lead_id);
  CREATE INDEX IF NOT EXISTS idx_deals_signed_at ON deals(signed_at);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_student_otp_phone ON student_otp_codes(phone);
  CREATE INDEX IF NOT EXISTS idx_student_otp_expires ON student_otp_codes(expires_at);
  CREATE INDEX IF NOT EXISTS idx_agent_missions_status ON agent_missions(status);
  CREATE INDEX IF NOT EXISTS idx_agent_missions_tenant ON agent_missions(tenant);
  CREATE INDEX IF NOT EXISTS idx_agent_missions_created_at ON agent_missions(created_at);
  CREATE INDEX IF NOT EXISTS idx_agent_steps_mission_id ON agent_steps(mission_id);
  CREATE INDEX IF NOT EXISTS idx_agent_steps_needs_approval ON agent_steps(needs_approval, approved_at);
  CREATE INDEX IF NOT EXISTS idx_jobs_status_scheduled ON jobs(status, scheduled_at);
  CREATE INDEX IF NOT EXISTS idx_jobs_name_status ON jobs(name, status);
  CREATE INDEX IF NOT EXISTS idx_jobs_singleton ON jobs(singleton_key) WHERE singleton_key IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_leads_tenant_status ON leads(tenant, status);
  CREATE INDEX IF NOT EXISTS idx_leads_tenant_created ON leads(tenant, created_at);
  CREATE INDEX IF NOT EXISTS idx_content_items_tenant_status ON content_items(tenant, status);
  CREATE INDEX IF NOT EXISTS idx_rpa_tasks_account_status ON rpa_tasks(account_id, status);
`);

const columnExists = (table: string, column: string): boolean => {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
};

if (!columnExists('content_items', 'body_json')) {
  db.exec(`ALTER TABLE content_items ADD COLUMN body_json TEXT`);
}

if (!columnExists('rpa_tasks', 'content_id')) {
  db.exec(`ALTER TABLE rpa_tasks ADD COLUMN content_id INTEGER`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_rpa_tasks_content_id ON rpa_tasks(content_id)`);
}

if (!columnExists('agreements', 'legal_reviewed')) {
  db.exec(`ALTER TABLE agreements ADD COLUMN legal_reviewed INTEGER NOT NULL DEFAULT 0`);
  db.exec(`ALTER TABLE agreements ADD COLUMN legal_reviewed_by TEXT`);
  db.exec(`ALTER TABLE agreements ADD COLUMN legal_reviewed_at TEXT`);
}

// KOS 归因：rpa_accounts.operator_user_id → 员工
if (!columnExists('rpa_accounts', 'operator_user_id')) {
  db.exec(`ALTER TABLE rpa_accounts ADD COLUMN operator_user_id INTEGER`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_rpa_accounts_operator_user_id ON rpa_accounts(operator_user_id)`);
}

// leads 归因：通过 rpa_account_id 跟踪从哪个 RPA 账号来的
if (!columnExists('leads', 'source_account_id')) {
  db.exec(`ALTER TABLE leads ADD COLUMN source_account_id INTEGER`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_leads_source_account ON leads(source_account_id)`);
}

// 多租户迁移：给主要业务表补 tenant 字段（默认 default）
const TENANT_TABLES = ['leads', 'content_items', 'deposits', 'rpa_accounts', 'lead_forms'] as const;
for (const table of TENANT_TABLES) {
  if (!columnExists(table, 'tenant')) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN tenant TEXT NOT NULL DEFAULT 'default'`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_tenant ON ${table}(tenant)`);
  }
}

const leadCount = db.prepare('SELECT COUNT(*) as count FROM leads').get() as { count: number };
const contentCount = db.prepare('SELECT COUNT(*) as count FROM content_items').get() as { count: number };
const schoolCount = db.prepare('SELECT COUNT(*) as count FROM schools').get() as { count: number };
const materialCount = db.prepare('SELECT COUNT(*) as count FROM student_materials').get() as { count: number };
const courseCount = db.prepare('SELECT COUNT(*) as count FROM courses').get() as { count: number };
const attendanceCount = db.prepare('SELECT COUNT(*) as count FROM attendance_records').get() as { count: number };
const agreementCount = db.prepare('SELECT COUNT(*) as count FROM agreements').get() as { count: number };
const rpaAccountCount = db.prepare('SELECT COUNT(*) as count FROM rpa_accounts').get() as { count: number };
const leadFormCount = db.prepare('SELECT COUNT(*) as count FROM lead_forms').get() as { count: number };
const crawlerSourceCount = db.prepare('SELECT COUNT(*) as count FROM crawler_sources').get() as { count: number };
const violationWordCount = db.prepare('SELECT COUNT(*) as count FROM violation_words').get() as { count: number };
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
const scheduleConfigCount = db.prepare('SELECT COUNT(*) as count FROM agent_schedule_configs').get() as { count: number };

if (config.nodeEnv === 'development' && config.enableDbSeed && leadCount.count === 0) {
  const insertLead = db.prepare(`
    INSERT INTO leads (source, nickname, contact, intent, last_message, status, assignee, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `);

  const leadOne = insertLead.run('小红书', '考研小助手', null, 'high', '专升本怎么报名？', 'new', '张三');
  insertLead.run('抖音', '奋斗的小李', null, 'medium', '学费可以分期吗？', 'contacted', '李四');
  const leadThree = insertLead.run('快手', '想提升学历的喵', null, 'high', '会计专业通过率高吗？', 'following', '王五');

  db.prepare(`
    INSERT INTO followups (lead_id, channel, content, next_action, next_followup_at, created_at)
    VALUES (?, 'system', '系统初始化导入线索', '尽快联系', null, datetime('now'))
  `).run(leadOne.lastInsertRowid);

  db.prepare(`
    INSERT INTO enrollments (lead_id, school_name, major_name, stage, note, created_at, updated_at)
    VALUES (?, '广东开放大学', '会计学', 'applied', '已确认报读，等待首付款', datetime('now'), datetime('now'))
  `).run(leadThree.lastInsertRowid);

  db.prepare(`
    INSERT INTO payment_records (lead_id, total_amount, paid_amount, method, first_paid_at, next_payment_due_at, note, created_at, updated_at)
    VALUES (?, 12800, 3000, '分期', datetime('now'), datetime('now', '+7 day'), '已收首付款，待补尾款', datetime('now'), datetime('now'))
  `).run(leadThree.lastInsertRowid);
}

if (config.nodeEnv === 'development' && config.enableDbSeed && contentCount.count === 0) {
  const insertContent = db.prepare(`
    INSERT INTO content_items (title, type, platforms_json, status, reject_reason, generated_at, published_at, views, likes, comments, leads, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `);

  insertContent.run('2026专升本政策重磅更新：这3条变化直接影响你的报名资格', 'policy', JSON.stringify(['xhs', 'dy']), 'pending', null, '今天 09:15', null, 0, 0, 0, 0);
  insertContent.run('会计专业全解析：就业前景+学费+院校推荐一文看懂', 'major', JSON.stringify(['xhs', 'ks']), 'pending', null, '今天 08:30', null, 0, 0, 0, 0);
  insertContent.run('学历提升5个常见误区，80%的人都踩过坑', 'qa', JSON.stringify(['dy']), 'rejected', '内容过于保守，需要更强调机构通过率优势，请重新生成', '昨天 16:00', null, 0, 0, 0, 0);
  insertContent.run('报名倒计时15天！错过又等一年，别让拖延毁了你的本科梦', 'reminder', JSON.stringify(['dy', 'ks']), 'published', null, '昨天 20:00', '2026-03-14 12:00', 1560, 89, 23, 5);
  insertContent.run('会计专业vs工商管理：哪个更适合你？', 'major', JSON.stringify(['xhs']), 'published', null, '2026-03-13 18:00', '2026-03-13 20:00', 4210, 278, 95, 12);
  insertContent.run('学历提升5大常见误区，别再踩坑了', 'qa', JSON.stringify(['dy']), 'published', null, '2026-03-12 10:00', '2026-03-12 12:00', 12500, 890, 342, 22);
}

if (config.nodeEnv === 'development' && config.enableDbSeed && schoolCount.count === 0) {
  const insertSchool = db.prepare(`
    INSERT INTO schools (name, level, admission_types_json, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
  `);
  const insertMajor = db.prepare(`
    INSERT INTO school_majors (school_id, name, fee, duration, pass_rate, requirements, advantages, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `);

  const guangdongOpenUniversity = insertSchool.run('广东开放大学', '开放大学', JSON.stringify(['专升本']), '面向在职成人学习者，课程安排灵活。');
  insertMajor.run(guangdongOpenUniversity.lastInsertRowid, '会计学', 28000, '2.5年', '95%', null, null);
  insertMajor.run(guangdongOpenUniversity.lastInsertRowid, '工商管理', 32000, '2.5年', '92%', null, null);

  const southChinaNormalUniversity = insertSchool.run('华南师范大学', '211院校', JSON.stringify(['专升本']), '教育资源完善，覆盖热门专业。');
  insertMajor.run(southChinaNormalUniversity.lastInsertRowid, '计算机科学', 35000, '3年', '88%', null, null);
  insertMajor.run(southChinaNormalUniversity.lastInsertRowid, '法学', 30000, '2.5年', '90%', null, null);

  const jinanUniversity = insertSchool.run('暨南大学', '211院校', JSON.stringify(['专升本']), '护理与医学相关专业资源丰富。');
  insertMajor.run(jinanUniversity.lastInsertRowid, '护理学', 26000, '3年', '93%', null, null);
}

if (config.nodeEnv === 'development' && config.enableDbSeed && materialCount.count === 0) {
  const insertMaterial = db.prepare(`
    INSERT INTO student_materials (lead_id, name, status, uploaded_at, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `);
  const seedLead = db.prepare(`
    SELECT id
    FROM leads
    ORDER BY id ASC
    LIMIT 1
  `).get() as { id: number } | undefined;

  if (seedLead) {
    insertMaterial.run(seedLead.id, '身份证正反面', 'uploaded', '2026-04-10 10:00:00', '证件清晰可用');
    insertMaterial.run(seedLead.id, '学历证明', 'uploaded', '2026-04-10 10:05:00', '已完成审核');
    insertMaterial.run(seedLead.id, '一寸蓝底照片', 'pending', null, '需上传 JPG 格式，2MB 以内');
    insertMaterial.run(seedLead.id, '报名登记表', 'optional', null, '如需助学金申请可补充');
  }
}

if (config.nodeEnv === 'development' && config.enableDbSeed && courseCount.count === 0) {
  const insertCourse = db.prepare(`
    INSERT INTO courses (name, major, teacher, time, date, location, students, batch, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `);

  insertCourse.run('高等数学（一）', '会计学', '王教授', '09:00-11:30', '2026-04-18', '线上直播', 35, '2026春季班');
  insertCourse.run('基础会计', '会计学', '张教授', '09:00-11:30', '2026-04-19', '教室A301', 35, '2026春季班');
  insertCourse.run('英语（二）', '通用课程', '刘老师', '19:00-21:00', '2026-04-17', '线上直播', 60, '2026春季班');
  insertCourse.run('管理学原理', '工商管理', '李教授', '14:00-16:30', '2026-04-18', '线上直播', 28, '2026春季班');
}

if (config.nodeEnv === 'development' && config.enableDbSeed && attendanceCount.count === 0) {
  const insertAttendance = db.prepare(`
    INSERT INTO attendance_records (student_name, course_name, date, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
  `);

  insertAttendance.run('王小明', '高等数学（一）', '2026-04-13', 'present');
  insertAttendance.run('李华', '管理学原理', '2026-04-13', 'present');
  insertAttendance.run('赵六', '高等数学（一）', '2026-04-13', 'absent');
  insertAttendance.run('张伟', '基础会计', '2026-04-12', 'late');
  insertAttendance.run('刘芳', '英语（二）', '2026-04-12', 'present');
  insertAttendance.run('陈强', '高等数学（一）', '2026-04-11', 'leave');
}

if (config.enableDbSeed && agreementCount.count === 0) {
  const insertAgreement = db.prepare(`
    INSERT INTO agreements (type, version, content, is_active, created_at)
    VALUES (?, ?, ?, 1, datetime('now'))
  `);

  insertAgreement.run('privacy_policy', 'v1.0',
    '# 隐私政策\n\n我们重视您的个人信息保护。本政策说明我们收集、使用、存储、分享您个人信息的规则。\n\n## 一、我们收集的信息\n- 联系方式（手机号）：用于向您提供招生咨询与专业匹配报告\n- 教育背景、意向专业、时间预算、预算区间：用于个性化生成您的专业匹配报告\n\n## 二、信息的使用\n- 仅用于向您提供招生咨询服务与后续专业匹配\n- 未经您明确同意，不会用于其他目的\n- 未经您明确同意，不会向任何第三方提供您的个人信息\n\n## 三、信息的存储\n- 存储于中国境内的服务器\n- 保留期：自您主动要求删除之日起 30 日内完成删除；未主动要求的，保留至合作服务关系终止后 2 年\n\n## 四、您的权利\n- 查询、更正、删除您的个人信息\n- 撤回授权\n- 投诉举报\n\n您可以在学员自助端的「授权管理」中行使以上权利，或联系客服。');

  insertAgreement.run('user_agreement', 'v1.0',
    '# 用户协议\n\n## 一、服务内容\n本系统为您提供招生咨询、专业匹配、学历提升服务对接。\n\n## 二、用户义务\n- 提供真实、准确的信息\n- 不得利用本系统从事任何违法活动\n\n## 三、服务方义务\n- 保护您的个人信息安全\n- 不对任何 "包过""100% 通过""保录取"等不实承诺承担责任\n- 成交以双方签订的正式报名合同为准\n\n## 四、服务终止\n您可随时终止使用本服务，并申请删除您的个人信息。');

  insertAgreement.run('personal_info_authorization', 'v1.0',
    '# 个人信息授权书\n\n本人自愿同意：\n\n1. **授权收集**：手机号、教育背景、意向专业、时间预算、预算区间等信息\n2. **授权用途**：仅限于专业匹配报告生成、招生咨询服务、后续跟进沟通\n3. **授权期限**：自授权之日起至我主动撤回之日止\n4. **授权对象**：武汉聪可智核科技有限公司及其合作的正规教育机构（云南德天惠军教育发展有限公司）\n\n**我已充分理解本授权书的内容，并同意以上全部条款。**');
}

if (config.enableDbSeed && leadFormCount.count === 0) {
  const privacyId = (db.prepare(`SELECT id FROM agreements WHERE type = 'personal_info_authorization' AND is_active = 1 ORDER BY id DESC LIMIT 1`).get() as { id: number } | undefined)?.id;

  if (privacyId) {
    db.prepare(`
      INSERT INTO lead_forms (type, name, fields_json, agreement_id, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))
    `).run('assessment', '2026 专业匹配测评', JSON.stringify([
      {
        key: 'education',
        label: '你当前的学历',
        options: ['高中 / 中专', '大专在读', '大专毕业', '本科在读', '本科毕业', '其他']
      },
      {
        key: 'goal',
        label: '你提升学历的主要目的',
        options: ['考公 / 考编', '升职加薪', '跳槽换行业', '考研', '兴趣 / 自我提升', '其他']
      },
      {
        key: 'time',
        label: '你能投入的每周学习时间',
        options: ['< 5 小时', '5-10 小时', '10-20 小时', '> 20 小时', '随时都可以']
      },
      {
        key: 'budget',
        label: '可接受的总预算（元）',
        options: ['< 1 万', '1-2 万', '2-3 万', '3-5 万', '> 5 万']
      },
      {
        key: 'concern',
        label: '你最担心的问题是',
        options: ['学费贵 / 难负担', '担心通过率', '没时间学习', '不知道选什么专业', '担心学历不被认可', '其他']
      }
    ]), privacyId);
  }
}

if (config.enableDbSeed && rpaAccountCount.count === 0) {
  const insertRpaAccount = db.prepare(`
    INSERT INTO rpa_accounts (platform, nickname, role, device_fingerprint, status, daily_quota, followers, risk_note, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?, ?, datetime('now'), datetime('now'))
  `);

  const matrix: Array<{ platform: string; nickname: string; role: string; quota: number; followers: number }> = [
    { platform: 'xiaohongshu', nickname: '聪学姐-品牌', role: 'brand', quota: 5, followers: 0 },
    { platform: 'xiaohongshu', nickname: '聪学姐-学姐号', role: 'persona', quota: 5, followers: 0 },
    { platform: 'xiaohongshu', nickname: '聪学姐-顾问号', role: 'persona', quota: 5, followers: 0 },
    { platform: 'douyin', nickname: '聪学姐-品牌', role: 'brand', quota: 5, followers: 0 },
    { platform: 'douyin', nickname: '聪学姐-学姐号', role: 'persona', quota: 5, followers: 0 },
    { platform: 'douyin', nickname: '聪学姐-顾问号', role: 'persona', quota: 5, followers: 0 },
    { platform: 'kuaishou', nickname: '聪学姐-品牌', role: 'brand', quota: 5, followers: 0 },
    { platform: 'kuaishou', nickname: '聪学姐-学姐号', role: 'persona', quota: 5, followers: 0 },
    { platform: 'kuaishou', nickname: '聪学姐-顾问号', role: 'persona', quota: 5, followers: 0 },
  ];

  for (const account of matrix) {
    insertRpaAccount.run(
      account.platform,
      account.nickname,
      account.role,
      `fp_${account.platform}_${account.nickname}_${Date.now()}`,
      account.quota,
      account.followers,
      '测试账号，与主营账号隔离'
    );
  }
}

if (config.enableDbSeed && crawlerSourceCount.count === 0) {
  const insertSource = db.prepare(`
    INSERT INTO crawler_sources (name, domain, type, frequency_hours, is_enabled, created_at)
    VALUES (?, ?, ?, ?, 1, datetime('now'))
  `);

  insertSource.run('教育部官网 - 高等教育政策', 'moe.gov.cn', 'policy', 24);
  insertSource.run('云南省教育考试院', 'ynzs.cn', 'policy', 24);
  insertSource.run('广东省教育考试院', 'eeagd.edu.cn', 'policy', 24);
  insertSource.run('广东开放大学 - 招生简章', 'gdrtvu.edu.cn', 'school_admission', 168);
  insertSource.run('华南师范大学 - 继续教育学院', 'scnu.edu.cn', 'school_admission', 168);
}

if (config.enableDbSeed && userCount.count === 0) {
  const insertUser = db.prepare(`
    INSERT INTO users (username, password_hash, name, role, phone, tenant, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
  `);

  const defaultAdminPwd = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'admin123456';
  const defaultTenantPwd = process.env.BOOTSTRAP_TENANT_PASSWORD || 'tenant123456';
  const defaultSpecialistPwd = process.env.BOOTSTRAP_SPECIALIST_PASSWORD || 'specialist123';

  insertUser.run('admin', hashPassword(defaultAdminPwd), '甲方管理员', 'admin', null, 'platform');
  insertUser.run('tenant_admin', hashPassword(defaultTenantPwd), '乙方老板', 'tenant_admin', null, 'default');
  insertUser.run('zhangsan', hashPassword(defaultSpecialistPwd), '张三', 'specialist', null, 'default');
  insertUser.run('lisi', hashPassword(defaultSpecialistPwd), '李四', 'specialist', null, 'default');
  insertUser.run('wangwu', hashPassword(defaultSpecialistPwd), '王五', 'specialist', null, 'default');
}

if (config.enableDbSeed && scheduleConfigCount.count === 0) {
  const insertSchedule = db.prepare(`
    INSERT INTO agent_schedule_configs (tenant, mission_type, cron_hour, cron_weekday, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, datetime('now'), datetime('now'))
  `);

  // 3 条预置定时计划（默认禁用，由用户手动开启）
  insertSchedule.run('default', 'daily_content_sprint', 8, null);        // 每天 8:30 跑
  insertSchedule.run('default', 'lead_followup_sweep', 9, null);         // 每天 9:00 跑
  insertSchedule.run('default', 'weekly_report', 20, 'mon');             // 每周一 20:00 跑
}

if (config.enableDbSeed && violationWordCount.count === 0) {
  const insertWord = db.prepare(`
    INSERT INTO violation_words (word, severity, reason, is_active, created_at)
    VALUES (?, 'block', ?, 1, datetime('now'))
  `);

  // 违规词库基于 2025 年各省市监管局公开处罚案例 + 小红书/抖音教培治理公告 整理
  // 详见 Execute_Plan/Competitive-Analysis.md §3
  const defaults: Array<[string, string]> = [
    // 通过/录取承诺（北京/江苏/长沙典型案例）
    ['包过', '监管处罚高发，违反《广告法》第 24 条'],
    ['100%通过', '虚假承诺，北京市监管局 2025 年顶格罚款'],
    ['100% 通过', '虚假承诺（含空格变体）'],
    ['100%录取', '虚假承诺'],
    ['100% 录取', '虚假承诺（含空格变体）'],
    ['保录取', '虚假承诺，涉嫌误导消费者'],
    ['保过', '虚假承诺，监管重点词'],
    ['保证通过', '虚假承诺，广告法明令禁止'],
    ['稳过', '虚假承诺'],
    ['必过', '虚假承诺'],
    ['包录取', '虚假承诺'],
    ['包毕业', '虚假承诺'],
    ['包就业', '虚假承诺，就业保障类违规'],
    ['协议保录', '虚假承诺（江苏 2025 典型案例同款）'],
    ['协议通过', '虚假承诺'],
    ['不过退款', '虚假承诺，违反《广告法》'],
    ['考不过退费', '与"不过退款"同类，监管重点'],
    ['免考', '虚假承诺，涉嫌虚假宣传'],

    // 内部关系类（市场监管总局多案）
    ['内部名额', '虚假宣传，涉嫌误导'],
    ['内部指标', '同上'],
    ['内部关系', '同上'],
    ['内部渠道', '同上'],
    ['特殊渠道', '同上'],
    ['有关系', '监管重点表述'],

    // 虚假背书类（江苏 2025 典型案例）
    ['教材主编', '未经核实的教师身份宣称，虚假背书'],
    ['首席讲师', '同上，需实际任职证明'],
    ['出题老师', '涉嫌与考试机构相关宣传，监管禁止'],
    ['命题专家', '同上'],
    ['阅卷老师', '同上'],

    // 夸大效果类（市场监管总局处罚案例）
    ['快速致富', '涉嫌虚假宣传'],
    ['毕业即就业', '涉嫌虚假就业承诺'],
    ['零基础速成', '夸大效果'],
    ['X 天过', '夸大学习速度（配合正则检测多样变体）'],
    ['十天包过', '具体案例词'],
    ['十五天过', '具体案例词'],

    // 隐性保证类（北京 2025 典型案例）
    ['持证上岗教师', '需证明所有教师确实持证'],
    ['高质量保证', '隐性保证词，监管重点'],
    ['名师团队', '需具体名单，否则虚假宣传'],

    // 诱导性宣传
    ['最后一次', '涉嫌制造紧迫感的虚假宣传'],
    ['限时优惠仅此一天', '同上（配合正则识别"限时"类夸大）'],

    // 考试机构名称直接引用（小红书治理公告重点）
    ['学信网合作', '涉嫌虚假官方背书'],
    ['教育部授权', '未经官方确认的背书'],
  ];

  for (const [word, reason] of defaults) {
    try {
      insertWord.run(word, reason);
    } catch {
      // 已存在则跳过
    }
  }
}
