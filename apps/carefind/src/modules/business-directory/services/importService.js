import * as XLSX from 'xlsx';
import { businessDirectoryRepository } from '../repositories/businessDirectoryRepository.js';
import {
  normalizeBusinessName,
  normalizePhoneNumber,
  findPotentialDuplicates,
} from './deduplicationService.js';
import { geocodeAddress } from './locationService.js';

/**
 * Import Service
 * Handles CSV/Excel import with validation and deduplication
 */

/**
 * Required fields for import
 */
const REQUIRED_FIELDS = ['name', 'category'];

/**
 * Valid category names (will be matched case-insensitively)
 */
const CATEGORY_MAPPINGS = {
  pharmacy: 'Pharmacy',
  hospital: 'Hospital',
  clinic: 'Clinic',
  'medical centre': 'Medical Centre',
  'medical center': 'Medical Centre',
  'specialist hospital': 'Specialist Hospital',
  'primary healthcare': 'Primary Healthcare Centre',
  'primary health': 'Primary Healthcare Centre',
  'diagnostic centre': 'Diagnostic Centre',
  'diagnostic center': 'Diagnostic Centre',
  'medical laboratory': 'Medical Laboratory',
  'laboratory': 'Medical Laboratory',
  'imaging centre': 'Imaging/Radiology Centre',
  'imaging center': 'Imaging/Radiology Centre',
  'radiology': 'Imaging/Radiology Centre',
  'pharmaceutical manufacturer': 'Pharmaceutical Manufacturer',
  'manufacturer': 'Pharmaceutical Manufacturer',
  'pharmaceutical distributor': 'Pharmaceutical Distributor',
  'distributor': 'Pharmaceutical Distributor',
  'medical equipment': 'Medical Equipment Company',
  'equipment company': 'Medical Equipment Company',
  'aesthetic centre': 'Aesthetic/Cosmetic Centre',
  'cosmetic centre': 'Aesthetic/Cosmetic Centre',
  'dental clinic': 'Dental Clinic',
  'dental': 'Dental Clinic',
  'eye clinic': 'Eye Clinic/Optometry',
  'optometry': 'Eye Clinic/Optometry',
  'physiotherapy': 'Physiotherapy/Rehabilitation',
  'rehabilitation': 'Physiotherapy/Rehabilitation',
  'maternity': 'Maternity',
  'paediatric': 'Paediatric Centre',
  'pediatric': 'Paediatric Centre',
  'cardiology': 'Cardiology Centre',
  'fertility': 'Fertility/IVF Centre',
  'ivf': 'Fertility/IVF Centre',
  'gynecology': 'Gynecology Centre',
  'gynaecology': 'Gynecology Centre',
  'dermatology': 'Dermatology',
  'wholesaler': 'Pharmaceutical Wholesaler',
  'supplier': 'Healthcare Supplier',
  'cosmetics': 'Cosmetics Business',
};

/**
 * Parse CSV file
 */
export async function parseCSV(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const lines = text.split('\n').filter((line) => line.trim());

        if (lines.length < 2) {
          reject(new Error('CSV file is empty or has no data rows'));
          return;
        }

        // Parse header
        const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());

        // Parse rows
        const records = [];
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map((v) => v.trim());
          const record = {};

          headers.forEach((header, index) => {
            record[header] = values[index] || '';
          });

          records.push(record);
        }

        resolve({ headers, records, totalRows: records.length });
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => reject(new Error('Failed to read CSV file'));
    reader.readAsText(file);
  });
}

/**
 * Parse Excel file
 */
export async function parseExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });

        // Get first sheet
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        // Convert to JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        if (jsonData.length < 2) {
          reject(new Error('Excel file is empty or has no data rows'));
          return;
        }

        // Parse header
        const headers = jsonData[0].map((h) => String(h).trim().toLowerCase());

        // Parse rows
        const records = [];
        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i];
          const record = {};

          headers.forEach((header, index) => {
            record[header] = row[index] ? String(row[index]).trim() : '';
          });

          records.push(record);
        }

        resolve({ headers, records, totalRows: records.length });
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => reject(new Error('Failed to read Excel file'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Parse file based on type
 */
export async function parseFile(file) {
  const extension = file.name.split('.').pop().toLowerCase();

  switch (extension) {
    case 'csv':
      return parseCSV(file);
    case 'xlsx':
    case 'xls':
      return parseExcel(file);
    default:
      throw new Error(`Unsupported file type: ${extension}`);
  }
}

/**
 * Validate a single record
 */
export function validateRecord(record, rowNumber) {
  const errors = [];

  // Check required fields
  for (const field of REQUIRED_FIELDS) {
    if (!record[field] || record[field].trim() === '') {
      errors.push({
        type: 'required',
        field,
        message: `${field} is required`,
        rowNumber,
      });
    }
  }

  // Validate email if provided
  if (record.email && record.email.trim() !== '') {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(record.email)) {
      errors.push({
        type: 'format',
        field: 'email',
        message: 'Invalid email format',
        rowNumber,
      });
    }
  }

  // Validate phone if provided
  if (record.phone && record.phone.trim() !== '') {
    const phoneRegex = /^[\d\s\-\+\(\)]+$/;
    if (!phoneRegex.test(record.phone)) {
      errors.push({
        type: 'format',
        field: 'phone',
        message: 'Invalid phone format',
        rowNumber,
      });
    }
  }

  // Validate latitude/longitude if provided
  if (record.latitude && record.longitude) {
    const lat = parseFloat(record.latitude);
    const lng = parseFloat(record.longitude);

    if (isNaN(lat) || lat < -90 || lat > 90) {
      errors.push({
        type: 'format',
        field: 'latitude',
        message: 'Invalid latitude (must be between -90 and 90)',
        rowNumber,
      });
    }

    if (isNaN(lng) || lng < -180 || lng > 180) {
      errors.push({
        type: 'format',
        field: 'longitude',
        message: 'Invalid longitude (must be between -180 and 180)',
        rowNumber,
      });
    }
  }

  return errors;
}

/**
 * Validate batch of records
 */
export async function validateBatch(records) {
  const allErrors = [];
  const validRecords = [];

  records.forEach((record, index) => {
    const rowNumber = index + 2; // +2 because row 1 is header
    const errors = validateRecord(record, rowNumber);

    if (errors.length === 0) {
      validRecords.push({ ...record, rowNumber });
    } else {
      allErrors.push(...errors);
    }
  });

  return {
    valid: validRecords,
    errors: allErrors,
    totalRecords: records.length,
    validCount: validRecords.length,
    errorCount: allErrors.length,
  };
}

/**
 * Map category name to category ID
 */
export async function mapCategoryName(categoryName, categories) {
  if (!categoryName) return null;

  const normalizedName = categoryName.toLowerCase().trim();

  // Direct match
  const directMatch = categories.find(
    (c) => c.name.toLowerCase() === normalizedName
  );
  if (directMatch) return directMatch.id;

  // Fuzzy match using mappings
  for (const [key, value] of Object.entries(CATEGORY_MAPPINGS)) {
    if (normalizedName.includes(key) || key.includes(normalizedName)) {
      const match = categories.find((c) => c.name === value);
      if (match) return match.id;
    }
  }

  return null;
}

/**
 * Transform record for database
 */
export function transformRecord(record, categories) {
  return {
    name: record.name?.trim() || '',
    normalized_name: normalizeBusinessName(record.name),
    category_id: mapCategoryName(record.category, categories),
    subcategory_id: record.subcategory?.trim() || null,
    business_type: record.business_type?.trim() || record.type?.trim() || null,
    address: record.address?.trim() || null,
    state: record.state?.trim() || null,
    lga: record.lga?.trim() || null,
    city: record.city?.trim() || null,
    area: record.area?.trim() || null,
    latitude: record.latitude ? parseFloat(record.latitude) : null,
    longitude: record.longitude ? parseFloat(record.longitude) : null,
    phone: record.phone?.trim() || null,
    email: record.email?.trim() || null,
    website: record.website?.trim() || null,
    whatsapp: record.whatsapp?.trim() || null,
    contact_person: record.contact_person?.trim() || record.contact?.trim() || null,
    description: record.description?.trim() || null,
    data_source: 'import',
  };
}

/**
 * Geocode addresses for records without coordinates
 */
export async function geocodeRecords(records) {
  const geocoded = [];
  const failed = [];

  for (const record of records) {
    if (record.latitude && record.longitude) {
      geocoded.push(record);
      continue;
    }

    if (record.address) {
      try {
        const coords = await geocodeAddress(record.address);
        if (coords) {
          geocoded.push({
            ...record,
            latitude: coords.latitude,
            longitude: coords.longitude,
          });
        } else {
          failed.push({ record, reason: 'Could not geocode address' });
        }
      } catch (error) {
        failed.push({ record, reason: error.message });
      }
    } else {
      failed.push({ record, reason: 'No address or coordinates provided' });
    }
  }

  return { geocoded, failed };
}

/**
 * Import businesses with validation and deduplication
 */
export async function importBusinesses(records, options = {}) {
  const {
    duplicateHandling = 'review', // 'skip', 'import_new', 'review'
    geocodeMissing = true,
    batchSize = 100,
  } = options;

  // Get categories for mapping
  const categories = await businessDirectoryRepository.getCategories();

  // Validate records
  const validation = await validateBatch(records);

  // Transform valid records
  const transformed = validation.valid.map((record) =>
    transformRecord(record, categories)
  );

  // Geocode if requested
  let toImport = transformed;
  let geocodingFailed = [];

  if (geocodeMissing) {
    const { geocoded, failed } = await geocodeRecords(transformed);
    toImport = geocoded;
    geocodingFailed = failed;
  }

  // Check for duplicates
  const existingBusinesses = await businessDirectoryRepository.listBusinesses(
    {},
    { page: 1, limit: 10000 }
  );

  const deduplicationResults = await findPotentialDuplicates(
    toImport,
    existingBusinesses.data
  );

  // Handle duplicates based on option
  const toInsert = [];
  const duplicates = [];

  for (const record of toImport) {
    const potentialDuplicates = deduplicationResults.filter(
      (d) => d.business.name === record.name
    );

    if (potentialDuplicates.length === 0) {
      toInsert.push(record);
    } else if (duplicateHandling === 'import_new') {
      toInsert.push(record);
    } else if (duplicateHandling === 'skip') {
      duplicates.push({ record, reason: 'Skipped due to duplicate handling option' });
    } else {
      // 'review' - flag for review
      duplicates.push({ record, potentialDuplicates });
    }
  }

  // Insert records in batches
  const inserted = [];
  const insertErrors = [];

  for (let i = 0; i < toInsert.length; i += batchSize) {
    const batch = toInsert.slice(i, i + batchSize);

    try {
      const results = await Promise.all(
        batch.map((record) =>
          businessDirectoryRepository.createBusiness(record).catch((error) => ({
            record,
            error: error.message,
          }))
        )
      );

      for (const result of results) {
        if (result.error) {
          insertErrors.push(result);
        } else {
          inserted.push(result);
        }
      }
    } catch (error) {
      insertErrors.push({ batch, error: error.message });
    }
  }

  return {
    totalRecords: records.length,
    validRecords: validation.validCount,
    invalidRecords: validation.errorCount,
    inserted: inserted.length,
    duplicates: duplicates.length,
    geocodingFailed: geocodingFailed.length,
    insertErrors: insertErrors.length,
    details: {
      validationErrors: validation.errors,
      duplicates,
      geocodingFailed,
      insertErrors,
    },
  };
}

/**
 * Generate import template
 */
export function generateImportTemplate() {
  const headers = [
    'name',
    'category',
    'subcategory',
    'business_type',
    'address',
    'state',
    'lga',
    'city',
    'area',
    'latitude',
    'longitude',
    'phone',
    'email',
    'website',
    'whatsapp',
    'contact_person',
    'description',
  ];

  const exampleRow = [
    'Example Pharmacy',
    'Pharmacy',
    'Community Pharmacy',
    'retail',
    '123 Example Street, Ikeja',
    'Lagos',
    'Ikeja',
    'Ikeja',
    'GRA',
    '6.5244',
    '3.3792',
    '+234 801 234 5678',
    'info@example.com',
    'www.example.com',
    '+234 801 234 5678',
    'John Doe',
    'A sample pharmacy business',
  ];

  return { headers, exampleRow };
}

export default {
  parseCSV,
  parseExcel,
  parseFile,
  validateRecord,
  validateBatch,
  mapCategoryName,
  transformRecord,
  geocodeRecords,
  importBusinesses,
  generateImportTemplate,
};
