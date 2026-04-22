import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from './config';

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

  CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
  CREATE INDEX IF NOT EXISTS idx_followups_lead_id ON followups(lead_id);
  CREATE INDEX IF NOT EXISTS idx_payment_records_lead_id ON payment_records(lead_id);
  CREATE INDEX IF NOT EXISTS idx_proposal_cards_lead_id ON proposal_cards(lead_id);
  CREATE INDEX IF NOT EXISTS idx_content_items_status ON content_items(status);
  CREATE INDEX IF NOT EXISTS idx_school_majors_school_id ON school_majors(school_id);
  CREATE INDEX IF NOT EXISTS idx_student_materials_lead_id ON student_materials(lead_id);
  CREATE INDEX IF NOT EXISTS idx_courses_major ON courses(major);
  CREATE INDEX IF NOT EXISTS idx_attendance_records_date ON attendance_records(date);
`);

const leadCount = db.prepare('SELECT COUNT(*) as count FROM leads').get() as { count: number };
const contentCount = db.prepare('SELECT COUNT(*) as count FROM content_items').get() as { count: number };
const schoolCount = db.prepare('SELECT COUNT(*) as count FROM schools').get() as { count: number };
const materialCount = db.prepare('SELECT COUNT(*) as count FROM student_materials').get() as { count: number };
const courseCount = db.prepare('SELECT COUNT(*) as count FROM courses').get() as { count: number };
const attendanceCount = db.prepare('SELECT COUNT(*) as count FROM attendance_records').get() as { count: number };

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
