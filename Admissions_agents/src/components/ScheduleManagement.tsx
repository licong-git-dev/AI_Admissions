/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Clock,
  MapPin,
  Users,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Plus,
  BookOpen,
  GraduationCap,
  Bell,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/cn';
import type { AttendanceRecord, CourseItem, ScheduleSummary } from '../types';

type ScheduleTab = 'schedule' | 'attendance';

const SCHEDULE_TABS: { id: ScheduleTab; label: string }[] = [
  { id: 'schedule', label: '课程表' },
  { id: 'attendance', label: '考勤记录' },
];

const ATTENDANCE_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  present: { label: '出勤', color: 'text-emerald-600 bg-emerald-50 border-emerald-100', icon: CheckCircle2 },
  absent: { label: '缺勤', color: 'text-red-600 bg-red-50 border-red-100', icon: XCircle },
  late: { label: '迟到', color: 'text-amber-600 bg-amber-50 border-amber-100', icon: AlertCircle },
  leave: { label: '请假', color: 'text-blue-600 bg-blue-50 border-blue-100', icon: Clock },
};

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const payload = await response.json();

  if (!response.ok || !payload.success) {
    throw new Error(payload.error || '请求失败');
  }

  return payload.data as T;
}

function getMonday(date: Date): Date {
  const next = new Date(date);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  next.setHours(0, 0, 0, 0);
  return next;
}

function formatWeekRange(monday: Date): string {
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const format = (current: Date) => `${current.getMonth() + 1}月${current.getDate()}日`;
  return `${format(monday)} - ${format(sunday)}`;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function ScheduleManagement() {
  const [activeTab, setActiveTab] = useState<ScheduleTab>('schedule');
  const [weekStart, setWeekStart] = useState<Date>(() => getMonday(new Date()));
  const [summary, setSummary] = useState<ScheduleSummary | null>(null);
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let alive = true;

    const loadSchedule = async () => {
      setLoading(true);
      try {
        const [summaryData, courseData, attendanceData] = await Promise.all([
          fetchJson<ScheduleSummary>('/api/schedule/summary'),
          fetchJson<CourseItem[]>('/api/schedule/courses'),
          fetchJson<AttendanceRecord[]>('/api/schedule/attendance'),
        ]);

        if (!alive) {
          return;
        }

        setSummary(summaryData);
        setCourses(courseData);
        setAttendance(attendanceData);
        setErrorMsg('');
      } catch {
        if (!alive) {
          return;
        }
        setSummary(null);
        setCourses([]);
        setAttendance([]);
        setErrorMsg('排课数据加载失败，请确认后端服务已启动');
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    };

    void loadSchedule();

    return () => {
      alive = false;
    };
  }, []);

  const currentWeek = formatWeekRange(weekStart);
  const weekDates = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + index);
    return formatLocalDate(date);
  });

  const weeklyCourses = useMemo(
    () => courses.filter((course) => weekDates.includes(course.date)),
    [courses, weekDates],
  );

  const goToPrevWeek = () => {
    setWeekStart((current) => {
      const next = new Date(current);
      next.setDate(next.getDate() - 7);
      return next;
    });
  };

  const goToNextWeek = () => {
    setWeekStart((current) => {
      const next = new Date(current);
      next.setDate(next.getDate() + 7);
      return next;
    });
  };

  return (
    <div className="h-full flex flex-col gap-6">
      {errorMsg && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: '本周课程', value: `${summary?.thisWeekCourseCount ?? 0}节`, icon: BookOpen, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: '在读学员', value: `${summary?.studyingCount ?? 0}人`, icon: GraduationCap, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: '平均出勤率', value: `${summary?.attendanceRate ?? 0}%`, icon: CheckCircle2, color: 'text-indigo-600', bg: 'bg-indigo-50' },
          { label: '待发提醒', value: `${summary?.pendingReminderCount ?? 0}条`, icon: Bell, color: 'text-amber-600', bg: 'bg-amber-50' },
        ].map((stat) => (
          <div key={stat.label} className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className={cn('p-2 rounded-xl', stat.bg)}>
                <stat.icon className={cn('w-6 h-6', stat.color)} />
              </div>
            </div>
            <p className="text-sm text-gray-500 font-medium">{stat.label}</p>
            <h3 className="text-2xl font-bold text-gray-900 mt-1">{stat.value}</h3>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex bg-white border border-gray-200 p-1 rounded-xl shadow-sm">
          {SCHEDULE_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn('px-5 py-2 rounded-lg text-sm font-bold transition-all', activeTab === tab.id ? 'bg-emerald-50 text-emerald-600 shadow-sm' : 'text-gray-400 hover:text-gray-600')}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {activeTab === 'schedule' && (
            <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-2 shadow-sm">
              <button onClick={goToPrevWeek} className="p-1 hover:bg-gray-100 rounded-lg transition-colors">
                <ChevronLeft className="w-4 h-4 text-gray-500" />
              </button>
              <span className="text-sm font-bold text-gray-700 min-w-[140px] text-center">{currentWeek}</span>
              <button onClick={goToNextWeek} className="p-1 hover:bg-gray-100 rounded-lg transition-colors">
                <ChevronRight className="w-4 h-4 text-gray-500" />
              </button>
            </div>
          )}
          <button className="flex items-center gap-2 px-6 py-2.5 bg-emerald-500 text-white rounded-xl font-bold text-sm hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20">
            <Plus className="w-4 h-4" />
            {activeTab === 'schedule' ? '新增课程' : '录入考勤'}
          </button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'schedule' && (
          <motion.div key="schedule" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex-1 space-y-4">
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="grid grid-cols-7 border-b border-gray-100">
                {WEEKDAYS.map((day, index) => (
                  <div key={day} className={cn('px-4 py-3 text-center text-xs font-bold uppercase tracking-wider', index === 5 || index === 6 ? 'text-emerald-600 bg-emerald-50/30' : 'text-gray-400')}>
                    {day}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 min-h-[400px]">
                {WEEKDAYS.map((_, dayIndex) => (
                  <div key={dayIndex} className="border-r border-gray-50 last:border-r-0 p-2 space-y-2">
                    {weeklyCourses.filter((course) => course.date === weekDates[dayIndex]).map((course) => (
                      <div key={course.id} className="cursor-pointer rounded-xl border border-emerald-100 bg-emerald-50 p-3 transition-all hover:shadow-md">
                        <p className="mb-1 truncate text-xs font-bold text-emerald-800">{course.name}</p>
                        <p className="mb-2 text-[10px] text-emerald-600">{course.time}</p>
                        <div className="flex items-center gap-1 text-[10px] text-emerald-500">
                          <MapPin className="w-3 h-3" />
                          <span className="truncate">{course.location}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
              <h3 className="font-bold text-gray-900 mb-4">近期课程安排</h3>
              <div className="space-y-3">
                {courses.map((course) => (
                  <div key={course.id} className="flex items-center justify-between rounded-xl border border-gray-100 p-4 transition-all hover:border-emerald-100 hover:bg-emerald-50/20">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 flex flex-col items-center justify-center">
                        <span className="text-[10px] font-bold">{course.date.split('-')[1]}月</span>
                        <span className="text-sm font-bold leading-none">{course.date.split('-')[2]}</span>
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-gray-900">{course.name}</h4>
                        <p className="text-xs text-gray-500">{course.major} · {course.teacher} · {course.batch}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <p className="text-sm font-bold text-gray-900">{course.time}</p>
                        <div className="flex items-center justify-end gap-1 text-[10px] text-gray-400">
                          <MapPin className="w-3 h-3" />
                          {course.location}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 rounded-lg bg-gray-50 px-2 py-1 text-xs text-gray-500">
                        <Users className="w-3 h-3" />
                        {course.students}人
                      </div>
                      <button className="rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-600 transition-all hover:bg-emerald-100">
                        发送提醒
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'attendance' && (
          <motion.div key="attendance" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex-1 flex flex-col gap-4">
            <div className="grid grid-cols-4 gap-4">
              {Object.entries(ATTENDANCE_CONFIG).map(([key, config]) => {
                const count = attendance.filter((item) => item.status === key).length;
                return (
                  <div key={key} className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className={cn('rounded-xl p-2', config.color.split(' ')[1])}>
                      <config.icon className={cn('w-5 h-5', config.color.split(' ')[0])} />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">{config.label}</p>
                      <p className="text-lg font-bold text-gray-900">{count}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex-1 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/50 text-gray-400">
                      <th className="px-6 py-4 text-left font-medium">学员姓名</th>
                      <th className="px-6 py-4 text-left font-medium">课程名称</th>
                      <th className="px-6 py-4 text-left font-medium">日期</th>
                      <th className="px-6 py-4 text-left font-medium">考勤状态</th>
                      <th className="px-6 py-4 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {attendance.map((record) => {
                      const config = ATTENDANCE_CONFIG[record.status];
                      return (
                        <tr key={record.id} className="group transition-colors hover:bg-gray-50">
                          <td className="px-6 py-4 font-bold text-gray-900">{record.studentName}</td>
                          <td className="px-6 py-4 text-gray-600">{record.courseName}</td>
                          <td className="px-6 py-4 text-gray-500">{record.date}</td>
                          <td className="px-6 py-4">
                            <span className={cn('rounded-lg border px-2 py-1 text-[10px] font-bold', config.color)}>
                              {config.label}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button className="text-xs font-bold text-emerald-600 transition-all hover:underline">修改</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default ScheduleManagement;
