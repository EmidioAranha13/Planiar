import { create } from 'zustand';

type Theme = 'light' | 'dark';
type CalendarView = 'timeGridWeek' | 'dayGridMonth';

type UiState = {
  theme: Theme;
  view: CalendarView;
  routineId: string | null;
  selectedActivityId: string | null;
  activityOrder: string[];
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setView: (view: CalendarView) => void;
  setRoutineId: (routineId: string | null) => void;
  setSelectedActivityId: (selectedActivityId: string | null) => void;
  setActivityOrder: (activityOrder: string[]) => void;
};

const storedTheme = typeof localStorage === 'undefined' ? 'light' : localStorage.getItem('planiar.theme');

export const useUiStore = create<UiState>((set, get) => ({
  theme: storedTheme === 'dark' ? 'dark' : 'light',
  view: 'timeGridWeek',
  routineId: null,
  selectedActivityId: null,
  activityOrder: [],
  setTheme: (theme) => {
    localStorage.setItem('planiar.theme', theme);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    set({ theme });
  },
  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
  setView: (view) => set({ view }),
  setRoutineId: (routineId) => set({ routineId }),
  setSelectedActivityId: (selectedActivityId) => set({ selectedActivityId }),
  setActivityOrder: (activityOrder) => set({ activityOrder }),
}));
