import React from 'react';
import { FileText, Download, Table, AlertTriangle, Calendar, Users, Briefcase } from 'lucide-react';
import { ScheduleEntry, Course, Faculty, Room, StudentGroup, Term, Clash, UserAccount } from '../types';

interface ReportsPanelProps {
  schedule: ScheduleEntry[];
  courses: Course[];
  faculties: Faculty[];
  rooms: Room[];
  groups: StudentGroup[];
  terms: Term[];
  clashes: Clash[];
  currentUser: UserAccount;
  activeTermId?: string;
}

const ReportsPanel: React.FC<ReportsPanelProps> = ({
  schedule,
  courses,
  faculties,
  rooms,
  groups,
  terms,
  clashes,
  currentUser,
  activeTermId
}) => {
  
  const downloadCSV = (data: any[], filename: string) => {
    if (data.length === 0) {
      alert("No data available for this report.");
      return;
    }
    
    const headers = Object.keys(data[0]);
    const csvRows = [
      headers.join(','),
      ...data.map(row => 
        headers.map(fieldName => {
          const value = row[fieldName] || '';
          const escaped = ('' + value).replace(/"/g, '""');
          return `"${escaped}"`;
        }).join(',')
      )
    ];

    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${filename}_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getFilteredSchedule = () => {
    return activeTermId 
      ? schedule.filter(s => s.termId === activeTermId)
      : schedule;
  };

  const getFullTimetableData = (filteredSchedule: ScheduleEntry[]) => {
    return filteredSchedule.map((s, index) => {
      const course = courses.find(c => c.id === s.courseId);
      const faculty = faculties.find(f => f.id === s.facultyId);
      const room = rooms.find(r => r.id === s.roomId);
      const groupNames = groups
        .filter(g => s.groupIds?.includes(g.id))
        .map(g => (g as any)._unique_name || g.name)
        .join(', ');

      return {
        '_event_id': index + 1,
        '_day_of_week': s.day.substring(0, 3), 
        '_start_time': s.startTime,
        '_end_time': s.endTime,
        '_weeks': 'Jan-25',
        '_event_type': s.category || 'Explo',
        'Module Unique ID': (course as any)?._unique_name || course?.code || '',
        'Module': (course as any)?._name || course?.name || '',
        'Room': (room as any)?._unique_name || room?.name || '',
        'Staff_ID': (faculty as any)?._Faculty_ID || faculty?.id || '',
        'Staff_Name': (faculty as any)?._Faculty_name || faculty?.name || '',
        'Group': groupNames || ''
      };
    });
  };

  const reportCards = [
    {
      id: 'full',
      title: 'Full Institutional Timetable',
      description: 'Complete list of all scheduled sessions across all colleges and departments.',
      icon: <Table className="w-5 h-5" />,
      action: () => downloadCSV(getFullTimetableData(getFilteredSchedule()), 'Full_University_Timetable')
    },
    {
      id: 'clashes',
      title: 'Conflict & Clash Report',
      description: 'Audit log of all current room, faculty, and group overlaps that require attention.',
      icon: <AlertTriangle className="w-5 h-5" />,
      action: () => {
        const data = clashes.map(c => ({
          'Type': c.type,
          'Message': c.message,
          'Status': 'Unresolved'
        }));
        downloadCSV(data, 'Institutional_Clash_Report');
      }
    },
    {
      id: 'resources',
      title: 'Resource Utilization',
      description: 'Summary of room capacity vs student enrollment for scheduled sessions.',
      icon: <Calendar className="w-5 h-5" />,
      action: () => {
        const data = getFilteredSchedule().map(s => {
          const room = rooms.find(r => r.id === s.roomId);
          const selectedGroups = groups.filter(g => s.groupIds?.includes(g.id));
          const totalStudents = selectedGroups.reduce((sum, g) => sum + (g.studentCount || 0), 0);
          const groupNames = selectedGroups.map(g => g.name).join(', ');
          
          return {
            'Room': room?.name,
            'Capacity': room?.capacity,
            'Groups': groupNames,
            'Total Students': totalStudents,
            'Utilization %': room ? Math.round(totalStudents / room.capacity * 100) : 0
          };
        });
        downloadCSV(data, 'Resource_Utilization_Report');
      }
    },
    {
      id: 'faculty_load',
      title: 'Faculty Load Report',
      description: 'Audit of faculty teaching hours and subject allocation for the active term.',
      icon: <Briefcase className="w-5 h-5" />,
      action: () => {
        const filteredSchedule = getFilteredSchedule();
        const data = faculties.map(f => {
          const facultySessions = filteredSchedule.filter(s => s.facultyId === f.id);
          const totalWeeklyMinutes = facultySessions.reduce((acc, s) => {
             const [sh, sm] = s.startTime.split(':').map(Number);
             const [eh, em] = s.endTime.split(':').map(Number);
             return acc + ((eh * 60 + em) - (sh * 60 + sm));
          }, 0);
          
          return {
            '_Faculty_ID': (f as any)?._Faculty_ID || f.id,
            '_Faculty_name': (f as any)?._Faculty_name || f.name,
            '_deptName': (f as any)?._deptName || f.department,
            'Faculty Load': Math.round(totalWeeklyMinutes / 60)
          };
        });
        downloadCSV(data, 'Faculty_Load_Report');
      }
    }
  ];

  return (
    <div className="space-y-4 p-2">
      <div className="flex justify-between items-end border-b-2 border-[#185baf] pb-1 mx-2 mb-4">
        <div>
          <h2 className="text-[16px] font-black text-[#185baf] uppercase tracking-wide">Reports & Analytics</h2>
          <p className="text-[10px] text-[#666] font-bold uppercase tracking-widest">Generate Excel-compatible CSV exports for {activeTermId ? terms.find(t => t.id === activeTermId)?.name : 'All Terms'}</p>
        </div>
      </div>

      <div className="px-2 grid grid-cols-1 md:grid-cols-2 gap-4">
        {reportCards.map((report) => (
          <div 
            key={report.id} 
            className="bg-[#f0f0f0] border-2 border-[#185baf] shadow-md flex flex-col justify-between"
          >
            <div className="p-4 bg-white flex-1">
              <div className="flex items-center gap-3 border-b border-[#eee] pb-3 mb-3">
                <div className="w-10 h-10 bg-[#f0f0f0] border-2 border-[#185baf] flex items-center justify-center text-[#185baf] shrink-0">
                  {report.icon}
                </div>
                <div>
                  <h3 className="text-[12px] font-black text-[#185baf] uppercase tracking-wide">{report.title}</h3>
                  <p className="text-[9px] text-[#666] font-bold uppercase tracking-widest mt-0.5">System Audit</p>
                </div>
              </div>
              <p className="text-[11px] text-[#333] font-medium leading-relaxed">{report.description}</p>
            </div>

            <div className="p-2 bg-[#e0e0e0] border-t border-[#ccc]">
              <button 
                onClick={report.action}
                className="w-full py-1.5 btn-primary text-sm flex items-center justify-center gap-2 shadow-sm"
              >
                <Download className="w-3.5 h-3.5" />
                Download CSV Report
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mx-2 mt-2 bg-[#185baf] p-4 border border-[#00479b] shadow-md text-white flex gap-4 items-center">
        <div className="w-12 h-12 bg-white/10 border border-white/20 flex items-center justify-center shrink-0">
          <FileText className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1">
          <h4 className="text-[11px] font-black uppercase tracking-wider">Custom Reporting Service</h4>
          <p className="text-[10px] text-[#e0e0e0] mt-1 font-bold leading-relaxed">
            Need a specific layout or data format? Our team can configure custom templates.
          </p>
        </div>
        <div>
           <button className="bg-white text-[#185baf] border flex items-center gap-1 border-[#185baf] px-4 py-1.5 text-[11px] font-bold uppercase hover:bg-[#f0f0f0] transition-colors leading-none tracking-wider whitespace-nowrap">
             Request Custom Template
           </button>
        </div>
      </div>
    </div>
  );
};

export default ReportsPanel;
