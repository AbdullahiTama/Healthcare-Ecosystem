import { useState, useRef } from 'react';
import { theme } from '../../styles/theme';

export default function SearchBar({ value, onSearch, onLocationSearch, hasLocation }) {
  const [inputValue, setInputValue] = useState(value);
  const inputRef = useRef(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSearch(inputValue);
  };

  const handleClear = () => {
    setInputValue('');
    onSearch('');
    inputRef.current?.focus();
  };

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      <div style={styles.inputWrapper}>
        <SearchIcon />
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Search pharmacies, hospitals, clinics..."
          style={styles.input}
        />
        {inputValue && (
          <button type="button" onClick={handleClear} style={styles.clearButton}>
            <XIcon />
          </button>
        )}
      </div>

      <div style={styles.actions}>
        <button
          type="button"
          onClick={onLocationSearch}
          style={{
            ...styles.locationButton,
            ...(hasLocation ? styles.locationButtonActive : {}),
          }}
        >
          <LocationIcon />
          {hasLocation ? 'Near Me' : 'Use Location'}
        </button>

        <button type="submit" style={styles.searchButton}>
          Search
        </button>
      </div>
    </form>
  );
}

// Icon Components
function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={theme.gray400} strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={theme.gray400} strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function LocationIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

const styles = {
  form: {
    display: 'flex',
    gap: '12px',
    marginBottom: '24px',
  },
  inputWrapper: {
    flex: 1,
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  input: {
    width: '100%',
    padding: '12px 16px 12px 44px',
    border: `1px solid ${theme.gray200}`,
    borderRadius: theme.radius.md,
    fontSize: '14px',
    color: theme.gray900,
    background: 'white',
    transition: 'border-color 0.2s',
  },
  clearButton: {
    position: 'absolute',
    right: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    border: 'none',
    borderRadius: '50%',
    background: theme.gray100,
    cursor: 'pointer',
  },
  actions: {
    display: 'flex',
    gap: '8px',
  },
  locationButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '12px 16px',
    border: `1px solid ${theme.gray200}`,
    borderRadius: theme.radius.md,
    background: 'white',
    color: theme.gray700,
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  locationButtonActive: {
    borderColor: theme.tealDeep,
    color: theme.tealDeep,
    background: theme.tealMist || '#f0fdfa',
  },
  searchButton: {
    padding: '12px 24px',
    border: 'none',
    borderRadius: theme.radius.md,
    background: theme.tealDeep,
    color: 'white',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'background 0.2s',
  },
};

export default SearchBar;
