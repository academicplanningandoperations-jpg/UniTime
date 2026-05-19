
export enum Role {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  SCHEDULER = 'SCHEDULER',
  VIEWER = 'VIEWER'
}

export type DayOfWeek = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday';

export type CourseType = 'Theory' | 'Lab' | 'Elective' | 'Seminar';

export interface UserAccount {
  id: string;
  username: string;
  password?: string;
  name: string;
  role: Role;
  departmentScope: string;
  lastLogin?: string;
}

export interface Term {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  academicYear: string;
  isActive: boolean;
}

export interface Course {
  id: string;
  termId?: string;
  code: string;
  name: string;
  credits: number;
  department: string;
  duration: number;
  type: CourseType;
  color?: string;
  totalRequiredHours?: number; // New: For modular timetabling (SOD)
}

export interface Faculty {
  id: string;
  termId?: string;
  facultyId?: string;
  name: string;
  department: string;
  availability: string[];
  maxHoursPerWeek: number; // New: Weekly hour limit
}

export interface Room {
  id: string;
  termId?: string;
  name: string;
  capacity: number;
  type: 'Lecture' | 'Lab' | 'Seminar';
}

export interface StudentGroup {
  id: string;
  termId?: string;
  name: string;
  program: string;
  semester: number;
  studentCount: number;
}

export interface ScheduleEntry {
  id: string;
  termId: string;
  courseId: string;
  facultyId: string;
  roomId: string | null;
  groupIds: string[];
  day: DayOfWeek;
  startTime: string;
  endTime: string;
  departmentId: string;
  weeks: number[];
  category?: string;
  createdBy?: string;
  createdAt?: string;
  updatedBy?: string;
  updatedAt?: string;
}

export interface Clash {
  type: 'Room' | 'Faculty' | 'Cohort' | 'Overlap' | 'LoadViolation';
  message: string;
  affectedIds: string[];
}

export type ViewType = 'Room' | 'Faculty' | 'Group' | 'Course';
