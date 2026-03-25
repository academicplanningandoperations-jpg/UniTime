
import { DayOfWeek, Term, Course, Faculty, Room, StudentGroup } from './types';

export const DAYS: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const TIME_SLOTS = [
  '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', 
  '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', 
  '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00'
];

export const TOTAL_WEEKS = 25;

export const COLORS = {
  primary: '#2563eb',
  secondary: '#64748b',
  danger: '#ef4444',
  warning: '#f59e0b',
  success: '#10b981',
};

export const MOCK_TERMS: Term[] = [
  { id: 't1', name: 'Fall Semester 2024', startDate: '2024-09-01', endDate: '2024-12-20', academicYear: '2024/25', isActive: true },
  { id: 't2', name: 'Spring Semester 2025', startDate: '2025-01-15', endDate: '2025-05-30', academicYear: '2024/25', isActive: false },
];

export const MOCK_COURSES: Course[] = [
  { id: 'c1', code: 'MKT101', name: 'Marketing Management', credits: 4, department: 'Business', duration: 1, type: 'Theory' },
  { id: 'c2', code: 'PHYS1033', name: 'Thermal Physics', credits: 3, department: 'Physics', duration: 1, type: 'Lab' },
  { id: 'c3', code: 'ENG101', name: 'Academic Writing', credits: 2, department: 'English', duration: 1, type: 'Theory' },
  { id: 'c4', code: 'AI404', name: 'Neural Networks', credits: 4, department: 'CS', duration: 1, type: 'Elective' },
];

export const MOCK_FACULTY: Faculty[] = [
  { id: 'f1', name: 'Dr. Alan Turing', department: 'CS', availability: [], maxHoursPerWeek: 18 },
  { id: 'f2', name: 'Prof. Ada Lovelace', department: 'Math', availability: [], maxHoursPerWeek: 15 },
];

export const MOCK_ROOMS: Room[] = [
  { id: 'r1', name: 'Lecture Hall A', capacity: 200, type: 'Lecture' },
  { id: 'r2', name: 'Lab 101', capacity: 30, type: 'Lab' },
  { id: 'r3', name: 'Seminar Room 5', capacity: 15, type: 'Seminar' },
];

export const MOCK_GROUPS: StudentGroup[] = [
  { id: 'g1', name: 'BBA-II-B1', program: 'BBA', semester: 2, studentCount: 60 },
  { id: 'g2', name: 'Physics Year 1', program: 'BSc Physics', semester: 1, studentCount: 40 },
  { id: 'g3', name: 'CS-I-A1', program: 'Computer Science', semester: 1, studentCount: 50 },
  { id: 'g4', name: 'ENG-III-C2', program: 'English Literature', semester: 3, studentCount: 35 },
  { id: 'g5', name: 'MBA-I-M1', program: 'MBA', semester: 1, studentCount: 45 },
  { id: 'g6', name: 'ART-II-A2', program: 'Fine Arts', semester: 2, studentCount: 25 },
];
