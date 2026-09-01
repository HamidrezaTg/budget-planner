import { createContext, useContext, useEffect, useState } from 'react';
import { currentMonth } from '../api.js';

const WorkingMonthContext = createContext(null);

export function WorkingMonthProvider({ children }) {
  const [month, setMonth] = useState(
    () => localStorage.getItem('bp-working-month') || currentMonth(),
  );

  useEffect(() => {
    localStorage.setItem('bp-working-month', month);
  }, [month]);

  return (
    <WorkingMonthContext.Provider value={{ month, setMonth }}>
      {children}
    </WorkingMonthContext.Provider>
  );
}

export function useWorkingMonth() {
  const value = useContext(WorkingMonthContext);
  if (!value) throw new Error('useWorkingMonth must be used inside WorkingMonthProvider');
  return value;
}
