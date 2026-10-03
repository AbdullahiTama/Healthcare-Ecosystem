import { useState, useEffect } from 'react';
import { theme } from '../../styles/theme';
import Button from '@care-ecosystem/design-system/components/ui/Button';
import Card from '@care-ecosystem/design-system/components/ui/Card';
import DataTable from '@care-ecosystem/design-system/components/ui/DataTable';
import Modal from '@care-ecosystem/design-system/components/ui/Modal';
import StatusBadge from '@care-ecosystem/design-system/components/ui/StatusBadge';
import BusinessForm from './components/BusinessForm';
import BusinessDetails from './components/BusinessDetails';
import VerificationBadge from './components/VerificationBadge';
import { useBusinessExport } from './hooks';
import { exportBusinesses } from './services/exportService';

export default function BusinessListTab({
  searchHook,
  categoriesHook,
  onEdit,
  onDelete,
  onError,
}) {
  const {
    query,
    setQuery,
    filters,
    setFilters,
    results,
    pagination,
    isLoading,
    search,
    refresh,
  } = searchHook;

  const { categories } = categoriesHook;
  const { exportData, isExporting } = useBusinessExport();

  const [selectedBusiness, setSelectedBusiness] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingBusiness, setEditingBusiness] = useState(null);
  const [showExportMenu, setShowExportMenu] = useState(false);

  // Load initial data
  useEffect(() => {
    search();
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    search(query, filters);
  };

  const handleFilterChange = (key, value) => {
    const newFilters = { ...filters, [key]: value };
    setFilters(newFilters);
    search(query, newFilters);
  };

  const handleClearFilters = () => {
    setFilters({});
    setQuery('');
    search('', {});
  };

  const handleViewDetails = (business) => {
    setSelectedBusiness(business);
    setShowDetails(true);
  };

  const handleEdit = (business) => {
    setEditingBusiness(business);
    setShowEditModal(true);
  };

  const handleExport = async (format) => {
    try {
      await exportData(results, format, {
        filename: `businesses_${new Date().toISOString().split('T')[0]}`,
      });
      setShowExportMenu(false);
    } catch (err) {
      onError(err.message);
    }
  };

  const columns = [
    {
      key: 'name',
      label: 'Business Name',
      render: (business) => (
        <div style={styles.nameCell}>
          <span style={styles.businessName}>{business.name}</span>
          {business.category && (
            <span style={styles.category}>{business.category.name}</span>
          )}
        </div>
      ),
    },
    {
      key: 'address',
      label: 'Address',
      render: (business) => (
        <span style={styles.address}>
          {business.address || 'â€”'}
          {business.city && `, ${business.city}`}
          {business.state && `, ${business.state}`}
        </span>
      ),
    },
    {
      key: 'phone',
      label: 'Phone',
      render: (business) => (
        <span style={styles.phone}>{business.phone || 'â€”'}</span>
      ),
    },
    {
      key: 'verification_status',
      label: 'Status',
      render: (business) => (
        <VerificationBadge status={business.verification_status} />
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (business) => (
        <div style={styles.actions}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleViewDetails(business)}
          >
            View
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleEdit(business)}
          >
            Edit
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div style={styles.container}>
      {/* Search and Filters */}
      <Card style={styles.searchCard}>
        <form onSubmit={handleSearch} style={styles.searchForm}>
          <div style={styles.searchInputWrapper}>
            <SearchIcon />
            <input
              type="text"
              placeholder="Search businesses by name, address, or phone..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={styles.searchInput}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                style={styles.clearButton}
              >
                Ã—
              </button>
            )}
          </div>
          <Button type="submit" variant="primary">
            Search
          </Button>
        </form>

        {/* Filters */}
        <div style={styles.filters}>
          <select
            value={filters.category_id || ''}
            onChange={(e) => handleFilterChange('category_id', e.target.value || null)}
            style={styles.select}
          >
            <option value="">All Categories</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>

          <select
            value={filters.verification_status || ''}
            onChange={(e) => handleFilterChange('verification_status', e.target.value || null)}
            style={styles.select}
          >
            <option value="">All Statuses</option>
            <option value="unverified">Unverified</option>
            <option value="pending">Pending</option>
            <option value="verified">Verified</option>
            <option value="rejected">Rejected</option>
          </select>

          <select
            value={filters.state || ''}
            onChange={(e) => handleFilterChange('state', e.target.value || null)}
            style={styles.select}
          >
            <option value="">All States</option>
            <option value="Lagos">Lagos</option>
            <option value="Abuja">Abuja</option>
            <option value="Kano">Kano</option>
            <option value="Oyo">Oyo</option>
            <option value="Rivers">Rivers</option>
          </select>

          {(filters.category_id || filters.verification_status || filters.state) && (
            <Button variant="ghost" size="sm" onClick={handleClearFilters}>
              Clear Filters
            </Button>
          )}
        </div>
      </Card>

      {/* Results Header */}
      <div style={styles.resultsHeader}>
        <span style={styles.resultCount}>
          {pagination.total} businesses found
        </span>
        <div style={styles.exportButtons}>
          <div style={styles.exportDropdown}>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<DownloadIcon />}
              onClick={() => setShowExportMenu(!showExportMenu)}
              disabled={results.length === 0}
            >
              Export
            </Button>
            {showExportMenu && (
              <div style={styles.exportMenu}>
                <button onClick={() => handleExport('csv')} style={styles.exportOption}>
                  Export as CSV
                </button>
                <button onClick={() => handleExport('excel')} style={styles.exportOption}>
                  Export as Excel
                </button>
                <button onClick={() => handleExport('pdf')} style={styles.exportOption}>
                  Export as PDF
                </button>
                <button onClick={() => handleExport('json')} style={styles.exportOption}>
                  Export as JSON
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Data Table */}
      <Card>
        <DataTable
          columns={columns}
          data={results}
          isLoading={isLoading}
          emptyMessage="No businesses found"
          onRowClick={handleViewDetails}
        />
      </Card>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div style={styles.pagination}>
          <Button
            variant="ghost"
            size="sm"
            disabled={pagination.page === 1}
            onClick={() => search(query, filters, pagination.page - 1)}
          >
            Previous
          </Button>
          <span style={styles.pageInfo}>
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={pagination.page === pagination.totalPages}
            onClick={() => search(query, filters, pagination.page + 1)}
          >
            Next
          </Button>
        </div>
      )}

      {/* Business Details Modal */}
      <Modal
        isOpen={showDetails}
        onClose={() => setShowDetails(false)}
        title="Business Details"
        size="lg"
      >
        {selectedBusiness && (
          <BusinessDetails
            business={selectedBusiness}
            onEdit={() => {
              setShowDetails(false);
              handleEdit(selectedBusiness);
            }}
            onVerified={(updated) => {
              setSelectedBusiness(updated);
              refresh();
            }}
            onClose={() => setShowDetails(false)}
          />
        )}
      </Modal>

      {/* Edit Business Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        title="Edit Business"
        size="lg"
      >
        {editingBusiness && (
          <BusinessForm
            business={editingBusiness}
            onSubmit={(updated) => {
              setShowEditModal(false);
              onEdit(updated);
            }}
            onCancel={() => setShowEditModal(false)}
          />
        )}
      </Modal>
    </div>
  );
}

// Icon components
function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={theme.gray400} strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  searchCard: {
    padding: '16px',
  },
  searchForm: {
    display: 'flex',
    gap: '12px',
    marginBottom: '12px',
  },
  searchInputWrapper: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '0 12px',
    background: theme.gray50,
    border: `1px solid ${theme.gray200}`,
    borderRadius: theme.radius.md,
  },
  searchInput: {
    flex: 1,
    padding: '10px 0',
    border: 'none',
    background: 'transparent',
    fontSize: '14px',
    outline: 'none',
  },
  clearButton: {
    background: 'none',
    border: 'none',
    fontSize: '18px',
    color: theme.gray400,
    cursor: 'pointer',
    padding: '0 4px',
  },
  filters: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap',
  },
  select: {
    padding: '8px 12px',
    border: `1px solid ${theme.gray200}`,
    borderRadius: theme.radius.md,
    fontSize: '13px',
    color: theme.gray700,
    background: 'white',
    cursor: 'pointer',
    minWidth: '150px',
  },
  resultsHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  resultCount: {
    fontSize: '14px',
    color: theme.gray500,
  },
  exportButtons: {
    position: 'relative',
  },
  exportDropdown: {
    position: 'relative',
  },
  exportMenu: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: '4px',
    background: 'white',
    border: `1px solid ${theme.gray200}`,
    borderRadius: theme.radius.md,
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
    zIndex: 10,
    minWidth: '150px',
  },
  exportOption: {
    display: 'block',
    width: '100%',
    padding: '10px 16px',
    textAlign: 'left',
    background: 'none',
    border: 'none',
    fontSize: '13px',
    color: theme.gray700,
    cursor: 'pointer',
  },
  pagination: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '16px',
    padding: '16px',
  },
  pageInfo: {
    fontSize: '13px',
    color: theme.gray500,
  },
  nameCell: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  businessName: {
    fontWeight: '600',
    color: theme.gray900,
  },
  category: {
    fontSize: '12px',
    color: theme.gray500,
  },
  address: {
    fontSize: '13px',
    color: theme.gray600,
    maxWidth: '250px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  phone: {
    fontSize: '13px',
    color: theme.gray600,
  },
  actions: {
    display: 'flex',
    gap: '8px',
  },
};
