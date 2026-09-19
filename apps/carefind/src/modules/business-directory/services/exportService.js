import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { formatDistance, calculateDistance } from './locationService.js';

/**
 * Export Service
 * Handles exporting business data to CSV, Excel, PDF, and JSON
 */

/**
 * Default export fields
 */
const DEFAULT_FIELDS = [
  'name',
  'category',
  'address',
  'state',
  'lga',
  'city',
  'phone',
  'email',
  'website',
  'verification_status',
  'latitude',
  'longitude',
];

/**
 * Field labels for display
 */
const FIELD_LABELS = {
  name: 'Business Name',
  category: 'Category',
  subcategory: 'Subcategory',
  address: 'Address',
  state: 'State',
  lga: 'LGA',
  city: 'City',
  area: 'Area',
  phone: 'Phone',
  email: 'Email',
  website: 'Website',
  whatsapp: 'WhatsApp',
  contact_person: 'Contact Person',
  latitude: 'Latitude',
  longitude: 'Longitude',
  verification_status: 'Verification Status',
  data_source: 'Data Source',
  distance: 'Distance (km)',
  created_at: 'Created At',
  updated_at: 'Updated At',
};

/**
 * Transform business data for export
 */
function transformForExport(businesses, fields = DEFAULT_FIELDS, referenceLocation = null) {
  return businesses.map((business) => {
    const row = {};

    for (const field of fields) {
      const label = FIELD_LABELS[field] || field;

      if (field === 'category' && business.category) {
        row[label] = business.category.name || '';
      } else if (field === 'subcategory' && business.subcategory) {
        row[label] = business.subcategory.name || '';
      } else if (field === 'distance' && referenceLocation && business.latitude) {
        // Calculate distance if reference location provided
        const dist = calculateDistance(
          referenceLocation.latitude,
          referenceLocation.longitude,
          business.latitude,
          business.longitude
        );
        row[label] = formatDistance(dist);
      } else if (field === 'created_at' || field === 'updated_at') {
        row[label] = business[field] ? new Date(business[field]).toLocaleDateString() : '';
      } else {
        row[label] = business[field] || '';
      }
    }

    return row;
  });
}

/**
 * Export to CSV
 */
export function toCSV(businesses, options = {}) {
  const { fields = DEFAULT_FIELDS, referenceLocation = null, filename = 'businesses' } = options;

  const transformed = transformForExport(businesses, fields, referenceLocation);
  const labels = fields.map((f) => FIELD_LABELS[f] || f);

  // Create CSV content
  const csvContent = [
    labels.join(','),
    ...transformed.map((row) =>
      labels
        .map((label) => {
          const value = String(row[label] || '');
          // Escape commas and quotes
          if (value.includes(',') || value.includes('"') || value.includes('\n')) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return value;
        })
        .join(',')
    ),
  ].join('\n');

  // Create blob and download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, `${filename}.csv`);

  return { success: true, count: businesses.length };
}

/**
 * Export to Excel
 */
export function toExcel(businesses, options = {}) {
  const { fields = DEFAULT_FIELDS, referenceLocation = null, filename = 'businesses' } = options;

  const transformed = transformForExport(businesses, fields, referenceLocation);

  // Create workbook
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(transformed);

  // Auto-width columns
  const colWidths = Object.keys(transformed[0] || {}).map((key) => ({
    wch: Math.max(key.length, ...transformed.map((row) => String(row[key] || '').length)) + 2,
  }));
  ws['!cols'] = colWidths;

  XLSX.utils.book_append_sheet(wb, ws, 'Businesses');

  // Generate buffer
  const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  downloadBlob(blob, `${filename}.xlsx`);

  return { success: true, count: businesses.length };
}

/**
 * Export to PDF
 */
export function toPDF(businesses, options = {}) {
  const {
    fields = DEFAULT_FIELDS,
    referenceLocation = null,
    filename = 'businesses',
    title = 'Business Directory Export',
  } = options;

  const transformed = transformForExport(businesses, fields, referenceLocation);
  const labels = fields.map((f) => FIELD_LABELS[f] || f);

  // Create PDF
  const doc = new jsPDF('l', 'mm', 'a4'); // Landscape

  // Add title
  doc.setFontSize(18);
  doc.text(title, 14, 22);

  // Add metadata
  doc.setFontSize(10);
  doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 30);
  doc.text(`Total Records: ${businesses.length}`, 14, 36);

  // Add table
  const tableData = transformed.map((row) => labels.map((label) => String(row[label] || '')));

  doc.autoTable({
    head: [labels],
    body: tableData,
    startY: 42,
    styles: {
      fontSize: 8,
      cellPadding: 2,
    },
    headStyles: {
      fillColor: [59, 130, 246],
      textColor: 255,
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: labels.reduce((acc, label, index) => {
      acc[index] = { cellWidth: 'auto' };
      return acc;
    }, {}),
  });

  // Save PDF
  doc.save(`${filename}.pdf`);

  return { success: true, count: businesses.length };
}

/**
 * Export to JSON
 */
export function toJSON(businesses, options = {}) {
  const { fields = DEFAULT_FIELDS, referenceLocation = null, filename = 'businesses' } = options;

  const transformed = transformForExport(businesses, fields, referenceLocation);

  const jsonContent = JSON.stringify(transformed, null, 2);
  const blob = new Blob([jsonContent], { type: 'application/json' });

  downloadBlob(blob, `${filename}.json`);

  return { success: true, count: businesses.length };
}

/**
 * Download blob as file
 */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export businesses based on format
 */
export function exportBusinesses(businesses, format, options = {}) {
  switch (format.toLowerCase()) {
    case 'csv':
      return toCSV(businesses, options);
    case 'excel':
    case 'xlsx':
      return toExcel(businesses, options);
    case 'pdf':
      return toPDF(businesses, options);
    case 'json':
      return toJSON(businesses, options);
    default:
      throw new Error(`Unsupported export format: ${format}`);
  }
}

/**
 * Generate export template (empty file with headers)
 */
export function generateExportTemplate(format, options = {}) {
  const { fields = DEFAULT_FIELDS } = options;

  const emptyBusinesses = [];
  return exportBusinesses(emptyBusinesses, format, {
    ...options,
    filename: 'business_export_template',
  });
}

export default {
  toCSV,
  toExcel,
  toPDF,
  toJSON,
  exportBusinesses,
  generateExportTemplate,
  FIELD_LABELS,
  DEFAULT_FIELDS,
};
