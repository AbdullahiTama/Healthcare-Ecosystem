import { useState } from 'react';
import { theme } from '../../styles/theme';
import { useCategories } from '../../business-directory/hooks';

export default function SearchFilters({ filters, onFilterChange, onClearLocation, hasLocation }) {
  const { categories } = useCategories();
  const [expandedSections, setExpandedSections] = useState({
    category: true,
    location: true,
    radius: true,
  });

  const toggleSection = (section) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const handleCategoryChange = (categoryId) => {
    onFilterChange({ category: categoryId || null });
  };

  const handleStateChange = (state) => {
    onFilterChange({ state: state || null });
  };

  const handleLgaChange = (lga) => {
    onFilterChange({ lga: lga || null });
  };

  const handleRadiusChange = (radius) => {
    onFilterChange({ radius: parseInt(radius) || 10 });
  };

  const handleClearAll = () => {
    onFilterChange({
      category: null,
      state: null,
      lga: null,
      radius: 10,
    });
    if (hasLocation) {
      onClearLocation();
    }
  };

  const hasActiveFilters = filters.category || filters.state || filters.lga || hasLocation;

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h3 style={styles.title}>Filters</h3>
        {hasActiveFilters && (
          <button onClick={handleClearAll} style={styles.clearAll}>
            Clear all
          </button>
        )}
      </div>

      {/* Category Filter */}
      <div style={styles.section}>
        <button
          onClick={() => toggleSection('category')}
          style={styles.sectionHeader}
        >
          <span>Category</span>
          <ChevronIcon expanded={expandedSections.category} />
        </button>
        {expandedSections.category && (
          <div style={styles.sectionContent}>
            <select
              value={filters.category || ''}
              onChange={(e) => handleCategoryChange(e.target.value)}
              style={styles.select}
            >
              <option value="">All Categories</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Location Filter */}
      <div style={styles.section}>
        <button
          onClick={() => toggleSection('location')}
          style={styles.sectionHeader}
        >
          <span>Location</span>
          <ChevronIcon expanded={expandedSections.location} />
        </button>
        {expandedSections.location && (
          <div style={styles.sectionContent}>
            <select
              value={filters.state || ''}
              onChange={(e) => handleStateChange(e.target.value)}
              style={styles.select}
            >
              <option value="">All States</option>
              <option value="Lagos">Lagos</option>
              <option value="Abuja">Abuja</option>
              <option value="Kano">Kano</option>
              <option value="Oyo">Oyo</option>
              <option value="Rivers">Rivers</option>
              <option value="Edo">Edo</option>
              <option value="Kaduna">Kaduna</option>
              <option value="Enugu">Enugu</option>
              <option value="Delta">Delta</option>
              <option value="Ogun">Ogun</option>
            </select>

            <input
              type="text"
              value={filters.lga || ''}
              onChange={(e) => handleLgaChange(e.target.value)}
              placeholder="LGA (optional)"
              style={styles.input}
            />
          </div>
        )}
      </div>

      {/* Radius Filter */}
      {hasLocation && (
        <div style={styles.section}>
          <button
            onClick={() => toggleSection('radius')}
            style={styles.sectionHeader}
          >
            <span>Distance</span>
            <ChevronIcon expanded={expandedSections.radius} />
          </button>
          {expandedSections.radius && (
            <div style={styles.sectionContent}>
              <div style={styles.radiusOptions}>
                {[5, 10, 25, 50, 100].map((radius) => (
                  <button
                    key={radius}
                    onClick={() => handleRadiusChange(radius)}
                    style={{
                      ...styles.radiusButton,
                      ...(filters.radius === radius ? styles.radiusButtonActive : {}),
                    }}
                  >
                    {radius} km
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Active Filters Summary */}
      {hasActiveFilters && (
        <div style={styles.activeFilters}>
          <span style={styles.activeFiltersLabel}>Active filters:</span>
          <div style={styles.filterTags}>
            {filters.category && (
              <span style={styles.filterTag}>
                {categories.find((c) => c.id === filters.category)?.name || 'Category'}
                <button onClick={() => handleCategoryChange(null)} style={styles.tagRemove}>
                  ×
                </button>
              </span>
            )}
            {filters.state && (
              <span style={styles.filterTag}>
                {filters.state}
                <button onClick={() => handleStateChange(null)} style={styles.tagRemove}>
                  ×
                </button>
              </span>
            )}
            {filters.lga && (
              <span style={styles.filterTag}>
                {filters.lga}
                <button onClick={() => handleLgaChange(null)} style={styles.tagRemove}>
                  ×
                </button>
              </span>
            )}
            {hasLocation && (
              <span style={styles.filterTag}>
                Near me ({filters.radius} km)
                <button onClick={onClearLocation} style={styles.tagRemove}>
                  ×
                </button>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Icon Components
function ChevronIcon({ expanded }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke={theme.gray400}
      strokeWidth="2"
      style={{
        transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
        transition: 'transform 0.2s',
      }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

const styles = {
  container: {
    background: 'white',
    border: `1px solid ${theme.gray200}`,
    borderRadius: theme.radius.md,
    padding: '16px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
  },
  title: {
    fontSize: '14px',
    fontWeight: '600',
    color: theme.gray900,
    margin: 0,
  },
  clearAll: {
    fontSize: '12px',
    color: theme.tealDeep,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
  },
  section: {
    borderTop: `1px solid ${theme.gray100}`,
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    padding: '12px 0',
    background: 'none',
    border: 'none',
    fontSize: '13px',
    fontWeight: '600',
    color: theme.gray700,
    cursor: 'pointer',
  },
  sectionContent: {
    padding: '0 0 12px 0',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  select: {
    width: '100%',
    padding: '8px 12px',
    border: `1px solid ${theme.gray200}`,
    borderRadius: theme.radius.sm,
    fontSize: '13px',
    color: theme.gray700,
    background: 'white',
    cursor: 'pointer',
  },
  input: {
    width: '100%',
    padding: '8px 12px',
    border: `1px solid ${theme.gray200}`,
    borderRadius: theme.radius.sm,
    fontSize: '13px',
    color: theme.gray700,
  },
  radiusOptions: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '6px',
  },
  radiusButton: {
    padding: '6px',
    border: `1px solid ${theme.gray200}`,
    borderRadius: theme.radius.sm,
    background: 'white',
    fontSize: '12px',
    color: theme.gray600,
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  radiusButtonActive: {
    borderColor: theme.tealDeep,
    color: theme.tealDeep,
    background: theme.tealMist || '#f0fdfa',
  },
  activeFilters: {
    marginTop: '16px',
    paddingTop: '16px',
    borderTop: `1px solid ${theme.gray100}`,
  },
  activeFiltersLabel: {
    fontSize: '12px',
    color: theme.gray500,
    display: 'block',
    marginBottom: '8px',
  },
  filterTags: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  },
  filterTag: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 8px',
    background: theme.tealMist || '#f0fdfa',
    color: theme.tealDeep,
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: '500',
  },
  tagRemove: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '14px',
    height: '14px',
    border: 'none',
    borderRadius: '50%',
    background: 'rgba(0,0,0,0.1)',
    color: 'inherit',
    fontSize: '12px',
    cursor: 'pointer',
    padding: 0,
    lineHeight: 1,
  },
};

export default SearchFilters;
