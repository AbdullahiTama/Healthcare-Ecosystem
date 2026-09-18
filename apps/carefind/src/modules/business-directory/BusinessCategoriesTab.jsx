import { useState } from 'react';
import { theme } from '../../../styles/theme';
import Button from '@care-ecosystem/design-system/components/ui/Button';
import Card from '@care-ecosystem/design-system/components/ui/Card';
import Modal from '@care-ecosystem/design-system/components/ui/Modal';
import { businessDirectoryRepository } from '../repositories/businessDirectoryRepository';

export default function BusinessCategoriesTab({ categoriesHook, onError }) {
  const { categories, isLoading, refresh, getSubcategories } = categoriesHook;

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [subcategories, setSubcategories] = useState([]);
  const [showSubcategories, setShowSubcategories] = useState(false);

  const handleAddCategory = () => {
    setEditingCategory(null);
    setShowAddModal(true);
  };

  const handleEditCategory = (category) => {
    setEditingCategory(category);
    setShowAddModal(true);
  };

  const handleViewSubcategories = async (category) => {
    setSelectedCategory(category);
    try {
      const subs = await getSubcategories(category.id);
      setSubcategories(subs);
      setShowSubcategories(true);
    } catch (err) {
      onError(err.message);
    }
  };

  const handleDeleteCategory = async (category) => {
    if (!confirm(`Are you sure you want to delete "${category.name}"?`)) {
      return;
    }

    try {
      await businessDirectoryRepository.deleteCategory(category.id);
      refresh();
    } catch (err) {
      onError(err.message);
    }
  };

  const handleSaveCategory = async (categoryData) => {
    try {
      if (editingCategory) {
        await businessDirectoryRepository.updateCategory(editingCategory.id, categoryData);
      } else {
        await businessDirectoryRepository.createCategory(categoryData);
      }
      setShowAddModal(false);
      refresh();
    } catch (err) {
      onError(err.message);
    }
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h2 style={styles.title}>Business Categories</h2>
        <Button variant="primary" onClick={handleAddCategory}>
          Add Category
        </Button>
      </div>

      {/* Categories Grid */}
      {isLoading ? (
        <div style={styles.loadingContainer}>
          <div style={styles.spinner} />
          <p>Loading categories...</p>
        </div>
      ) : (
        <div style={styles.grid}>
          {categories.map((category) => (
            <Card key={category.id} style={styles.categoryCard}>
              <div style={styles.categoryHeader}>
                <div
                  style={{
                    ...styles.categoryIcon,
                    background: category.color || theme.tealMist,
                  }}
                >
                  <CategoryIcon name={category.icon} />
                </div>
                <div style={styles.categoryActions}>
                  <button
                    onClick={() => handleViewSubcategories(category)}
                    style={styles.iconButton}
                    title="View subcategories"
                  >
                    <FolderIcon />
                  </button>
                  <button
                    onClick={() => handleEditCategory(category)}
                    style={styles.iconButton}
                    title="Edit category"
                  >
                    <EditIcon />
                  </button>
                  <button
                    onClick={() => handleDeleteCategory(category)}
                    style={{ ...styles.iconButton, color: theme.danger || '#ef4444' }}
                    title="Delete category"
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>
              <h3 style={styles.categoryName}>{category.name}</h3>
              <p style={styles.categorySlug}>{category.slug}</p>
              {category.description && (
                <p style={styles.categoryDescription}>{category.description}</p>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Add/Edit Category Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title={editingCategory ? 'Edit Category' : 'Add Category'}
        size="sm"
      >
        <CategoryForm
          category={editingCategory}
          onSubmit={handleSaveCategory}
          onCancel={() => setShowAddModal(false)}
        />
      </Modal>

      {/* Subcategories Modal */}
      <Modal
        isOpen={showSubcategories}
        onClose={() => setShowSubcategories(false)}
        title={`Subcategories - ${selectedCategory?.name || ''}`}
        size="md"
      >
        <div style={styles.subcategoriesList}>
          {subcategories.length === 0 ? (
            <p style={styles.emptyText}>No subcategories yet</p>
          ) : (
            subcategories.map((sub) => (
              <div key={sub.id} style={styles.subcategoryItem}>
                <span>{sub.name}</span>
                <span style={styles.subcategorySlug}>{sub.slug}</span>
              </div>
            ))
          )}
        </div>
      </Modal>
    </div>
  );
}

// Category Form Component
function CategoryForm({ category, onSubmit, onCancel }) {
  const [formData, setFormData] = useState({
    name: category?.name || '',
    slug: category?.slug || '',
    description: category?.description || '',
    icon: category?.icon || '',
    color: category?.color || '#3b82f6',
    sort_order: category?.sort_order || 0,
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const handleNameChange = (e) => {
    const name = e.target.value;
    setFormData({
      ...formData,
      name,
      slug: name
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-'),
    });
  };

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      <div style={styles.formGroup}>
        <label style={styles.label}>Name *</label>
        <input
          type="text"
          value={formData.name}
          onChange={handleNameChange}
          style={styles.input}
          required
        />
      </div>

      <div style={styles.formGroup}>
        <label style={styles.label}>Slug</label>
        <input
          type="text"
          value={formData.slug}
          onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
          style={styles.input}
        />
      </div>

      <div style={styles.formGroup}>
        <label style={styles.label}>Description</label>
        <textarea
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          style={styles.textarea}
          rows={3}
        />
      </div>

      <div style={styles.formRow}>
        <div style={styles.formGroup}>
          <label style={styles.label}>Icon</label>
          <input
            type="text"
            value={formData.icon}
            onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
            style={styles.input}
            placeholder="e.g., Pill, Hospital"
          />
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Color</label>
          <div style={styles.colorInputWrapper}>
            <input
              type="color"
              value={formData.color}
              onChange={(e) => setFormData({ ...formData, color: e.target.value })}
              style={styles.colorInput}
            />
            <input
              type="text"
              value={formData.color}
              onChange={(e) => setFormData({ ...formData, color: e.target.value })}
              style={{ ...styles.input, flex: 1 }}
            />
          </div>
        </div>
      </div>

      <div style={styles.formGroup}>
        <label style={styles.label}>Sort Order</label>
        <input
          type="number"
          value={formData.sort_order}
          onChange={(e) => setFormData({ ...formData, sort_order: parseInt(e.target.value) || 0 })}
          style={styles.input}
          min="0"
        />
      </div>

      <div style={styles.formActions}>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary">
          {category ? 'Update' : 'Create'}
        </Button>
      </div>
    </form>
  );
}

// Icon Components
function CategoryIcon({ name }) {
  const icons = {
    Pill: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
        <path d="M10.5 1.5H8C5.79086 1.5 4 3.29086 4 5.5V18.5C4 20.7091 5.79086 22.5 8 22.5H16C18.2091 22.5 20 20.7091 20 18.5V5.5C20 3.29086 18.2091 1.5 16 1.5H13.5" />
        <path d="M10.5 1.5V9.5C10.5 10.0523 10.9477 10.5 11.5 10.5H12.5C13.0523 10.5 13.5 10.0523 13.5 9.5V1.5" />
      </svg>
    ),
    Hospital: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
        <path d="M3 21H21" />
        <path d="M5 21V7L12 3L19 7V21" />
        <path d="M9 9H15" />
        <path d="M12 6V12" />
        <path d="M9 15H15" />
      </svg>
    ),
  };

  return icons[name] || icons.Pill;
}

function FolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: '18px',
    fontWeight: '600',
    color: theme.gray900,
    margin: 0,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '16px',
  },
  categoryCard: {
    padding: '16px',
  },
  categoryHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '12px',
  },
  categoryIcon: {
    width: '48px',
    height: '48px',
    borderRadius: theme.radius.md,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryActions: {
    display: 'flex',
    gap: '4px',
  },
  iconButton: {
    padding: '6px',
    background: 'none',
    border: 'none',
    borderRadius: theme.radius.sm,
    cursor: 'pointer',
    color: theme.gray500,
    transition: 'all 0.2s',
  },
  categoryName: {
    fontSize: '16px',
    fontWeight: '600',
    color: theme.gray900,
    margin: '0 0 4px 0',
  },
  categorySlug: {
    fontSize: '13px',
    color: theme.gray500,
    margin: 0,
  },
  categoryDescription: {
    fontSize: '13px',
    color: theme.gray600,
    marginTop: '8px',
    marginBottom: 0,
  },
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    padding: '48px',
  },
  spinner: {
    width: '32px',
    height: '32px',
    border: `3px solid ${theme.gray200}`,
    borderTopColor: theme.tealDeep,
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  formRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px',
  },
  label: {
    fontSize: '13px',
    fontWeight: '500',
    color: theme.gray700,
  },
  input: {
    padding: '10px 12px',
    border: `1px solid ${theme.gray200}`,
    borderRadius: theme.radius.md,
    fontSize: '14px',
    color: theme.gray900,
  },
  textarea: {
    padding: '10px 12px',
    border: `1px solid ${theme.gray200}`,
    borderRadius: theme.radius.md,
    fontSize: '14px',
    color: theme.gray900,
    resize: 'vertical',
  },
  colorInputWrapper: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  colorInput: {
    width: '40px',
    height: '40px',
    padding: 0,
    border: `1px solid ${theme.gray200}`,
    borderRadius: theme.radius.md,
    cursor: 'pointer',
  },
  formActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    marginTop: '8px',
  },
  subcategoriesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  subcategoryItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px',
    background: theme.gray50,
    borderRadius: theme.radius.md,
  },
  subcategorySlug: {
    fontSize: '12px',
    color: theme.gray500,
  },
  emptyText: {
    textAlign: 'center',
    color: theme.gray500,
    padding: '24px',
  },
};

export default BusinessCategoriesTab;
