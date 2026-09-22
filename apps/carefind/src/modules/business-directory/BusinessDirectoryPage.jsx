import { useState, useEffect } from 'react';
import { theme } from '../../styles/theme';
import Button from '@care-ecosystem/design-system/components/ui/Button';
import Card from '@care-ecosystem/design-system/components/ui/Card';
import Modal from '@care-ecosystem/design-system/components/ui/Modal';
import Toast from '@care-ecosystem/design-system/components/ui/Toast';
import BusinessListTab from './BusinessListTab';
import BusinessImportTab from './BusinessImportTab';
import BusinessCategoriesTab from './BusinessCategoriesTab';
import BusinessForm from './components/BusinessForm';
import { useBusinessSearch, useCategories } from './hooks';

const TABS = [
  { id: 'list', label: 'Business List', icon: 'List' },
  { id: 'import', label: 'Import', icon: 'Upload' },
  { id: 'categories', label: 'Categories', icon: 'Tag' },
];

export default function BusinessDirectoryPage() {
  const [activeTab, setActiveTab] = useState('list');
  const [showAddModal, setShowAddModal] = useState(false);
  const [toast, setToast] = useState(null);

  const searchHook = useBusinessSearch();
  const categoriesHook = useCategories();

  const handleBusinessAdded = (business) => {
    setShowAddModal(false);
    setToast({ type: 'success', message: 'Business added successfully' });
    searchHook.refresh();
  };

  const handleBusinessUpdated = (business) => {
    setToast({ type: 'success', message: 'Business updated successfully' });
    searchHook.refresh();
  };

  const handleBusinessDeleted = () => {
    setToast({ type: 'success', message: 'Business deleted successfully' });
    searchHook.refresh();
  };

  const handleError = (message) => {
    setToast({ type: 'error', message });
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Business Directory</h1>
          <p style={styles.subtitle}>Manage and search businesses in the directory</p>
        </div>
        <Button
          variant="primary"
          leftIcon={<PlusIcon />}
          onClick={() => setShowAddModal(true)}
        >
          Add Business
        </Button>
      </div>

      {/* Tabs */}
      <div style={styles.tabs}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            style={{
              ...styles.tab,
              ...(activeTab === tab.id ? styles.tabActive : {}),
            }}
            onClick={() => setActiveTab(tab.id)}
          >
            <TabIcon name={tab.icon} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div style={styles.content}>
        {activeTab === 'list' && (
          <BusinessListTab
            searchHook={searchHook}
            categoriesHook={categoriesHook}
            onEdit={() => {}}
            onDelete={handleBusinessDeleted}
            onError={handleError}
          />
        )}
        {activeTab === 'import' && (
          <BusinessImportTab
            onComplete={() => {
              setToast({ type: 'success', message: 'Import completed' });
              searchHook.refresh();
            }}
            onError={handleError}
          />
        )}
        {activeTab === 'categories' && (
          <BusinessCategoriesTab
            categoriesHook={categoriesHook}
            onError={handleError}
          />
        )}
      </div>

      {/* Add Business Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Add New Business"
        size="lg"
      >
        <BusinessForm
          onSubmit={handleBusinessAdded}
          onCancel={() => setShowAddModal(false)}
        />
      </Modal>

      {/* Toast */}
      {toast && (
        <Toast
          type={toast.type}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}

// Simple icon components
function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function TabIcon({ name }) {
  const icons = {
    List: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="8" y1="6" x2="21" y2="6" />
        <line x1="8" y1="12" x2="21" y2="12" />
        <line x1="8" y1="18" x2="21" y2="18" />
        <line x1="3" y1="6" x2="3.01" y2="6" />
        <line x1="3" y1="12" x2="3.01" y2="12" />
        <line x1="3" y1="18" x2="3.01" y2="18" />
      </svg>
    ),
    Upload: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
    ),
    Tag: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
        <line x1="7" y1="7" x2="7.01" y2="7" />
      </svg>
    ),
  };
  return icons[name] || null;
}

const styles = {
  container: {
    padding: '24px',
    maxWidth: '1400px',
    margin: '0 auto',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '24px',
  },
  title: {
    fontSize: '28px',
    fontWeight: '700',
    color: theme.gray900,
    margin: 0,
  },
  subtitle: {
    fontSize: '14px',
    color: theme.gray500,
    marginTop: '4px',
  },
  tabs: {
    display: 'flex',
    gap: '4px',
    borderBottom: `1px solid ${theme.gray200}`,
    marginBottom: '24px',
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 16px',
    background: 'transparent',
    border: 'none',
    borderBottom: '2px solid transparent',
    color: theme.gray500,
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  tabActive: {
    color: theme.tealDeep,
    borderBottomColor: theme.tealDeep,
  },
  content: {
    minHeight: '400px',
  },
};
