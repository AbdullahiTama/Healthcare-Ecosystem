/**
 * Business Directory Module
 * Central export point for all repository and service functions
 */

// Repository
export {
  createBusinessDirectoryRepository,
  businessDirectoryRepository,
} from './repositories/businessDirectoryRepository.js';

// Services
export * as locationService from './services/locationService.js';
export * as deduplicationService from './services/deduplicationService.js';
export * as importService from './services/importService.js';
export * as exportService from './services/exportService.js';
export * as queryParser from './services/queryParser.js';

// Re-export commonly used functions
export {
  getCurrentPosition,
  geocodeAddress,
  reverseGeocode,
  calculateDistance,
  formatDistance,
} from './services/locationService.js';

export {
  normalizeBusinessName,
  normalizePhoneNumber,
  calculateSimilarity,
  calculateDuplicateScore,
  findPotentialDuplicates,
} from './services/deduplicationService.js';

export {
  parseFile,
  validateRecord,
  validateBatch,
  importBusinesses,
  generateImportTemplate,
} from './services/importService.js';

export {
  toCSV,
  toExcel,
  toPDF,
  toJSON,
  exportBusinesses,
} from './services/exportService.js';

export {
  parseQuery,
  extractCategory,
  extractLocation,
  extractRadius,
  extractQuantity,
  generateSuggestions,
} from './services/queryParser.js';
