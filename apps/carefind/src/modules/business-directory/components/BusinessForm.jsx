import { useState, useEffect } from 'react';
import { theme } from '../../../styles/theme';
import Button from '@care-ecosystem/design-system/components/ui/Button';
import { useCategories, useLocation } from '../hooks';
import { businessDirectoryRepository } from '../repositories/businessDirectoryRepository';
import { geocodeAddress } from '../services/locationService';

export default function BusinessForm({ business, onSubmit, onCancel }) {
  const { categories, getSubcategories } = useCategories();
  const { getCurrentLocation, geocodeAddress: geocode } = useLocation();

  const [formData, setFormData] = useState({
    name: business?.name || '',
    category_id: business?.category_id || '',
    subcategory_id: business?.subcategory_id || '',
    business_type: business?.business_type || '',
    address: business?.address || '',
    state: business?.state || '',
    lga: business?.lga || '',
    city: business?.city || '',
    area: business?.area || '',
    latitude: business?.latitude || '',
    longitude: business?.longitude || '',
    phone: business?.phone || '',
    email: business?.email || '',
    website: business?.website || '',
    whatsapp: business?.whatsapp || '',
    contact_person: business?.contact_person || '',
    description: business?.description || '',
  });

  const [subcategories, setSubcategories] = useState([]);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [errors, setErrors] = useState({});

  // Load subcategories when category changes
  useEffect(() => {
    if (formData.category_id) {
      getSubcategories(formData.category_id).then(setSubcategories);
    } else {
      setSubcategories([]);
    }
  }, [formData.category_id, getSubcategories]);

  const validate = () => {
    const newErrors = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Business name is required';
    }

    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Invalid email address';
    }

    if (formData.latitude && (formData.latitude < -90 || formData.latitude > 90)) {
      newErrors.latitude = 'Invalid latitude';
    }

    if (formData.longitude && (formData.longitude < -180 || formData.longitude > 180)) {
      newErrors.longitude = 'Invalid longitude';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Clear error when user types
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: null }));
    }
  };

  const handleGetCurrentLocation = async () => {
    try {
      setIsGeocoding(true);
      const position = await getCurrentLocation();
      setFormData((prev) => ({
        ...prev,
        latitude: position.latitude,
        longitude: position.longitude,
      }));
    } catch (err) {
      setErrors((prev) => ({ ...prev, location: 'Failed to get current location' }));
    } finally {
      setIsGeocoding(false);
    }
  };

  const handleGeocodeAddress = async () => {
    if (!formData.address) return;

    try {
      setIsGeocoding(true);
      const result = await geocode(formData.address);
      if (result) {
        setFormData((prev) => ({
          ...prev,
          latitude: result.latitude,
          longitude: result.longitude,
        }));
      }
    } catch (err) {
      setErrors((prev) => ({ ...prev, geocoding: 'Failed to geocode address' }));
    } finally {
      setIsGeocoding(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (validate()) {
      onSubmit({
        ...formData,
        latitude: formData.latitude ? parseFloat(formData.latitude) : null,
        longitude: formData.longitude ? parseFloat(formData.longitude) : null,
      });
    }
  };

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      {/* Basic Information */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Basic Information</h3>

        <div style={styles.formGroup}>
          <label style={styles.label}>Business Name *</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => handleChange('name', e.target.value)}
            style={{ ...styles.input, ...(errors.name ? styles.inputError : {}) }}
            placeholder="Enter business name"
          />
          {errors.name && <span style={styles.error}>{errors.name}</span>}
        </div>

        <div style={styles.formRow}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Category</label>
            <select
              value={formData.category_id}
              onChange={(e) => handleChange('category_id', e.target.value)}
              style={styles.select}
            >
              <option value="">Select category</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Subcategory</label>
            <select
              value={formData.subcategory_id}
              onChange={(e) => handleChange('subcategory_id', e.target.value)}
              style={styles.select}
              disabled={!formData.category_id}
            >
              <option value="">Select subcategory</option>
              {subcategories.map((sub) => (
                <option key={sub.id} value={sub.id}>
                  {sub.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Business Type</label>
          <input
            type="text"
            value={formData.business_type}
            onChange={(e) => handleChange('business_type', e.target.value)}
            style={styles.input}
            placeholder="e.g., retail, wholesale, manufacturer"
          />
        </div>
      </div>

      {/* Location */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Location</h3>

        <div style={styles.formGroup}>
          <label style={styles.label}>Address</label>
          <div style={styles.addressRow}>
            <input
              type="text"
              value={formData.address}
              onChange={(e) => handleChange('address', e.target.value)}
              style={{ ...styles.input, flex: 1 }}
              placeholder="Enter full address"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleGeocodeAddress}
              disabled={!formData.address || isGeocoding}
            >
              {isGeocoding ? '...' : 'Geocode'}
            </Button>
          </div>
          {errors.geocoding && <span style={styles.error}>{errors.geocoding}</span>}
        </div>

        <div style={styles.formRow}>
          <div style={styles.formGroup}>
            <label style={styles.label}>State</label>
            <select
              value={formData.state}
              onChange={(e) => handleChange('state', e.target.value)}
              style={styles.select}
            >
              <option value="">Select state</option>
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
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>LGA</label>
            <input
              type="text"
              value={formData.lga}
              onChange={(e) => handleChange('lga', e.target.value)}
              style={styles.input}
              placeholder="Local Government Area"
            />
          </div>
        </div>

        <div style={styles.formRow}>
          <div style={styles.formGroup}>
            <label style={styles.label}>City/Town</label>
            <input
              type="text"
              value={formData.city}
              onChange={(e) => handleChange('city', e.target.value)}
              style={styles.input}
              placeholder="City or town"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Area</label>
            <input
              type="text"
              value={formData.area}
              onChange={(e) => handleChange('area', e.target.value)}
              style={styles.input}
              placeholder="Area or neighborhood"
            />
          </div>
        </div>

        <div style={styles.formRow}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Latitude</label>
            <input
              type="number"
              step="any"
              value={formData.latitude}
              onChange={(e) => handleChange('latitude', e.target.value)}
              style={{ ...styles.input, ...(errors.latitude ? styles.inputError : {}) }}
              placeholder="e.g., 6.5244"
            />
            {errors.latitude && <span style={styles.error}>{errors.latitude}</span>}
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Longitude</label>
            <input
              type="number"
              step="any"
              value={formData.longitude}
              onChange={(e) => handleChange('longitude', e.target.value)}
              style={{ ...styles.input, ...(errors.longitude ? styles.inputError : {}) }}
              placeholder="e.g., 3.3792"
            />
            {errors.longitude && <span style={styles.error}>{errors.longitude}</span>}
          </div>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleGetCurrentLocation}
          disabled={isGeocoding}
        >
          {isGeocoding ? 'Getting location...' : 'Use Current Location'}
        </Button>
        {errors.location && <span style={styles.error}>{errors.location}</span>}
      </div>

      {/* Contact Information */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Contact Information</h3>

        <div style={styles.formRow}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Phone Number</label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => handleChange('phone', e.target.value)}
              style={styles.input}
              placeholder="+234 xxx xxx xxxx"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>WhatsApp</label>
            <input
              type="tel"
              value={formData.whatsapp}
              onChange={(e) => handleChange('whatsapp', e.target.value)}
              style={styles.input}
              placeholder="+234 xxx xxx xxxx"
            />
          </div>
        </div>

        <div style={styles.formRow}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Email</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => handleChange('email', e.target.value)}
              style={{ ...styles.input, ...(errors.email ? styles.inputError : {}) }}
              placeholder="email@example.com"
            />
            {errors.email && <span style={styles.error}>{errors.email}</span>}
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Website</label>
            <input
              type="url"
              value={formData.website}
              onChange={(e) => handleChange('website', e.target.value)}
              style={styles.input}
              placeholder="https://example.com"
            />
          </div>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Contact Person</label>
          <input
            type="text"
            value={formData.contact_person}
            onChange={(e) => handleChange('contact_person', e.target.value)}
            style={styles.input}
            placeholder="Name of contact person"
          />
        </div>
      </div>

      {/* Description */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Additional Information</h3>

        <div style={styles.formGroup}>
          <label style={styles.label}>Description</label>
          <textarea
            value={formData.description}
            onChange={(e) => handleChange('description', e.target.value)}
            style={styles.textarea}
            rows={4}
            placeholder="Brief description of the business"
          />
        </div>
      </div>

      {/* Actions */}
      <div style={styles.actions}>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary">
          {business ? 'Update Business' : 'Add Business'}
        </Button>
      </div>
    </form>
  );
}

const styles = {
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  sectionTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: theme.gray900,
    margin: 0,
    paddingBottom: '8px',
    borderBottom: `1px solid ${theme.gray200}`,
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  formRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px',
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
    transition: 'border-color 0.2s',
  },
  inputError: {
    borderColor: theme.danger || '#ef4444',
  },
  select: {
    padding: '10px 12px',
    border: `1px solid ${theme.gray200}`,
    borderRadius: theme.radius.md,
    fontSize: '14px',
    color: theme.gray900,
    background: 'white',
    cursor: 'pointer',
  },
  textarea: {
    padding: '10px 12px',
    border: `1px solid ${theme.gray200}`,
    borderRadius: theme.radius.md,
    fontSize: '14px',
    color: theme.gray900,
    resize: 'vertical',
  },
  addressRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-start',
  },
  error: {
    fontSize: '12px',
    color: theme.danger || '#ef4444',
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    paddingTop: '16px',
    borderTop: `1px solid ${theme.gray200}`,
  },
};
