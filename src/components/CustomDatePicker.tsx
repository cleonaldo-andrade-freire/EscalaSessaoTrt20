import React from 'react';
import DatePicker, { registerLocale } from 'react-datepicker';
import { ptBR } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';
import { Calendar as CalendarIcon } from 'lucide-react';
import './CustomDatePicker.css';

// Registra o idioma português do Brasil para o calendário
registerLocale('pt-BR', ptBR);

interface CustomDatePickerProps {
  selected: Date | null;
  onChange: (date: Date | null) => void;
  placeholderText?: string;
  dateFormat?: string;
  showMonthYearPicker?: boolean;
  className?: string;
  wrapperClassName?: string;
  minDate?: Date;
  maxDate?: Date;
  disabled?: boolean;
}

const CustomDatePicker: React.FC<CustomDatePickerProps> = ({
  selected,
  onChange,
  placeholderText = "Selecione uma data",
  dateFormat = "dd/MM/yyyy",
  showMonthYearPicker = false,
  className = "",
  wrapperClassName = "",
  minDate,
  maxDate,
  disabled = false
}) => {
  return (
    <div className={`relative flex items-center w-full ${wrapperClassName}`}>
      <DatePicker
        selected={selected}
        onChange={onChange}
        locale="pt-BR"
        dateFormat={showMonthYearPicker ? "MM/yyyy" : dateFormat}
        showMonthYearPicker={showMonthYearPicker}
        placeholderText={placeholderText}
        minDate={minDate}
        maxDate={maxDate}
        disabled={disabled}
        className={`w-full pl-10 pr-3 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-gray-700 dark:text-gray-100 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
        wrapperClassName="w-full"
      />
      <CalendarIcon className="w-4 h-4 text-gray-400 absolute left-3 pointer-events-none" />
    </div>
  );
};

export default CustomDatePicker;
