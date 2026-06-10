import React, { useMemo, useEffect } from 'react';
import styled from '@emotion/styled';

const SelectorContainer = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  width: 100%;
`;

const SelectorGroup = styled.div`
  display: flex;
  flex-direction: column;
`;

const SelectorLabel = styled.label`
  font-weight: 800;
  margin-bottom: 6px;
  color: #536174;
  font-size: 0.72rem;
  text-transform: uppercase;
`;

const Dropdown = styled.select`
  min-height: 40px;
  padding: 7px 10px;
  font-size: 0.98rem;
  border: 1px solid #d7e0ea;
  border-radius: 8px;
  background-color: white;
  color: #102033;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);

  &:focus {
    border-color: #0878d8;
    box-shadow: 0 0 0 3px rgba(8, 120, 216, 0.12);
    outline: none;
  }
`;

const getDaysInMonth = (year, month) => {
  if (!month) return 31;
  return new Date(year || 2025, month, 0).getDate();
};

const DateSelector = ({ selectedDate, onDateChange }) => {
  const years = Array.from({ length: 6 }, (_, i) => 2021 + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  const days = useMemo(() => {
    const dayCount = getDaysInMonth(selectedDate.year, selectedDate.month);
    return Array.from({ length: dayCount }, (_, i) => i + 1);
  }, [selectedDate.year, selectedDate.month]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    onDateChange(name, parseInt(value, 10));
  };

  useEffect(() => {
    const maxDay = getDaysInMonth(selectedDate.year, selectedDate.month);

    if (selectedDate.day > maxDay) {
      onDateChange('day', maxDay);
    }
  }, [onDateChange, selectedDate.day, selectedDate.year, selectedDate.month]);

  return (
    <SelectorContainer>
      <SelectorGroup>
        <SelectorLabel>Year</SelectorLabel>
        <Dropdown name="year" value={selectedDate.year} onChange={handleChange}>
          {years.map(year => (
            <option key={year} value={year}>{year}</option>
          ))}
        </Dropdown>
      </SelectorGroup>

      <SelectorGroup>
        <SelectorLabel>Month</SelectorLabel>
        <Dropdown name="month" value={selectedDate.month} onChange={handleChange}>
          {months.map(month => (
            <option key={month} value={month}>{month}</option>
          ))}
        </Dropdown>
      </SelectorGroup>

      <SelectorGroup>
        <SelectorLabel>Day</SelectorLabel>
        <Dropdown name="day" value={selectedDate.day} onChange={handleChange}>
          {days.map(day => (
            <option key={day} value={day}>{day}</option>
          ))}
        </Dropdown>
      </SelectorGroup>
    </SelectorContainer>
  );
};

export default DateSelector;
