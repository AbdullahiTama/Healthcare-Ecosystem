import { calculateDistance } from './locationService.js';

/**
 * Deduplication Service
 * Handles fuzzy matching and duplicate detection for businesses
 */

/**
 * Normalize business name for comparison
 */
export function normalizeBusinessName(name) {
  if (!name) return '';

  let normalized = name.toLowerCase();

  // Remove common prefixes/suffixes
  const prefixes = ['the', 'a', 'an'];
  for (const prefix of prefixes) {
    if (normalized.startsWith(prefix + ' ')) {
      normalized = normalized.slice(prefix.length + 1);
    }
  }

  // Remove punctuation
  normalized = normalized.replace(/[^\w\s]/g, '');

  // Collapse whitespace
  normalized = normalized.replace(/\s+/g, ' ');

  // Trim
  normalized = normalized.trim();

  return normalized;
}

/**
 * Normalize phone number for comparison
 */
export function normalizePhoneNumber(phone) {
  if (!phone) return '';

  // Remove all non-digit characters
  let normalized = phone.replace(/\D/g, '');

  // Handle Nigerian phone numbers
  if (normalized.startsWith('234')) {
    normalized = '0' + normalized.slice(3);
  }
  if (normalized.startsWith('+234')) {
    normalized = '0' + normalized.slice(4);
  }
  if (normalized.startsWith('2340')) {
    normalized = '0' + normalized.slice(4);
  }

  // Ensure it starts with 0
  if (!normalized.startsWith('0') && normalized.length === 10) {
    normalized = '0' + normalized;
  }

  return normalized;
}

/**
 * Normalize address for comparison
 */
export function normalizeAddress(address) {
  if (!address) return '';

  let normalized = address.toLowerCase();

  // Replace common abbreviations
  const abbreviations = {
    st: 'street',
    rd: 'road',
    ave: 'avenue',
    blvd: 'boulevard',
    ln: 'lane',
    dr: 'drive',
    ct: 'court',
    pl: 'place',
    way: 'way',
    ter: 'terrace',
    cir: 'circle',
  };

  for (const [abbr, full] of Object.entries(abbreviations)) {
    const regex = new RegExp(`\\b${abbr}\\b`, 'g');
    normalized = normalized.replace(regex, full);
  }

  // Remove punctuation
  normalized = normalized.replace(/[^\w\s]/g, '');

  // Collapse whitespace
  normalized = normalized.replace(/\s+/g, ' ');

  // Trim
  normalized = normalized.trim();

  return normalized;
}

/**
 * Calculate Levenshtein distance between two strings
 */
export function levenshteinDistance(str1, str2) {
  const m = str1.length;
  const n = str2.length;

  // Create matrix
  const matrix = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(null));

  // Initialize first row and column
  for (let i = 0; i <= m; i++) {
    matrix[i][0] = i;
  }
  for (let j = 0; j <= n; j++) {
    matrix[0][j] = j;
  }

  // Fill matrix
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[m][n];
}

/**
 * Calculate similarity between two strings (0 to 1)
 */
export function calculateSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  if (str1 === str2) return 1;

  const distance = levenshteinDistance(str1, str2);
  const maxLength = Math.max(str1.length, str2.length);

  return 1 - distance / maxLength;
}

/**
 * Calculate Jaccard similarity between two strings
 */
export function jaccardSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  if (str1 === str2) return 1;

  const set1 = new Set(str1.split(' '));
  const set2 = new Set(str2.split(' '));

  const intersection = new Set([...set1].filter((x) => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  return intersection.size / union.size;
}

/**
 * Calculate composite similarity score for two businesses
 */
export function calculateDuplicateScore(newBusiness, existingBusiness) {
  let score = 0;
  let weights = 0;

  // Name similarity (40% weight)
  const newName = normalizeBusinessName(newBusiness.name);
  const existingName = normalizeBusinessName(existingBusiness.name);

  if (newName && existingName) {
    const nameSimilarity = calculateSimilarity(newName, existingName);
    score += nameSimilarity * 0.4;
    weights += 0.4;
  }

  // Phone match (20% weight)
  const newPhone = normalizePhoneNumber(newBusiness.phone);
  const existingPhone = normalizePhoneNumber(existingBusiness.phone);

  if (newPhone && existingPhone) {
    const phoneMatch = newPhone === existingPhone ? 1 : 0;
    score += phoneMatch * 0.2;
    weights += 0.2;
  }

  // Address similarity (20% weight)
  const newAddress = normalizeAddress(newBusiness.address);
  const existingAddress = normalizeAddress(existingBusiness.address);

  if (newAddress && existingAddress) {
    const addressSimilarity = calculateSimilarity(newAddress, existingAddress);
    score += addressSimilarity * 0.2;
    weights += 0.2;
  }

  // Location proximity (20% weight)
  if (
    newBusiness.latitude &&
    existingBusiness.latitude &&
    newBusiness.longitude &&
    existingBusiness.longitude
  ) {
    const distance = calculateDistance(
      newBusiness.latitude,
      newBusiness.longitude,
      existingBusiness.latitude,
      existingBusiness.longitude
    );

    let proximityScore = 0;
    if (distance < 0.1) proximityScore = 1; // Within 100m
    else if (distance < 0.5) proximityScore = 0.8; // Within 500m
    else if (distance < 1) proximityScore = 0.6; // Within 1km
    else if (distance < 2) proximityScore = 0.4; // Within 2km
    else if (distance < 5) proximityScore = 0.2; // Within 5km

    score += proximityScore * 0.2;
    weights += 0.2;
  }

  // Category match (bonus)
  if (newBusiness.category_id && existingBusiness.category_id) {
    if (newBusiness.category_id === existingBusiness.category_id) {
      score += 0.1;
      weights += 0.1;
    }
  }

  // Normalize score
  return weights > 0 ? score / weights : 0;
}

/**
 * Classify duplicate status
 */
export function classifyDuplicateStatus(score, threshold = 0.7) {
  if (score >= 0.9) return 'confirmed';
  if (score >= threshold) return 'possible';
  return 'new';
}

/**
 * Find potential duplicates for a business
 */
export async function findPotentialDuplicates(business, existingBusinesses, options = {}) {
  const { threshold = 0.7, limit = 10 } = options;

  const duplicates = [];

  for (const existing of existingBusinesses) {
    // Skip if same ID
    if (existing.id === business.id) continue;

    const score = calculateDuplicateScore(business, existing);

    if (score >= threshold) {
      duplicates.push({
        business: existing,
        score,
        status: classifyDuplicateStatus(score, threshold),
        reasons: getDuplicateReasons(business, existing),
      });
    }
  }

  // Sort by score descending
  duplicates.sort((a, b) => b.score - a.score);

  return duplicates.slice(0, limit);
}

/**
 * Get reasons why two businesses might be duplicates
 */
export function getDuplicateReasons(newBusiness, existingBusiness) {
  const reasons = [];

  // Name similarity
  const newName = normalizeBusinessName(newBusiness.name);
  const existingName = normalizeBusinessName(existingBusiness.name);
  if (newName && existingName) {
    const nameSimilarity = calculateSimilarity(newName, existingName);
    if (nameSimilarity > 0.8) {
      reasons.push({
        type: 'name',
        description: 'Very similar business names',
        score: nameSimilarity,
      });
    }
  }

  // Phone match
  const newPhone = normalizePhoneNumber(newBusiness.phone);
  const existingPhone = normalizePhoneNumber(existingBusiness.phone);
  if (newPhone && existingPhone && newPhone === existingPhone) {
    reasons.push({
      type: 'phone',
      description: 'Same phone number',
      score: 1,
    });
  }

  // Address similarity
  const newAddress = normalizeAddress(newBusiness.address);
  const existingAddress = normalizeAddress(existingBusiness.address);
  if (newAddress && existingAddress) {
    const addressSimilarity = calculateSimilarity(newAddress, existingAddress);
    if (addressSimilarity > 0.7) {
      reasons.push({
        type: 'address',
        description: 'Very similar addresses',
        score: addressSimilarity,
      });
    }
  }

  // Location proximity
  if (
    newBusiness.latitude &&
    existingBusiness.latitude &&
    newBusiness.longitude &&
    existingBusiness.longitude
  ) {
    const distance = calculateDistance(
      newBusiness.latitude,
      newBusiness.longitude,
      existingBusiness.latitude,
      existingBusiness.longitude
    );

    if (distance < 0.5) {
      reasons.push({
        type: 'location',
        description: `Very close proximity (${Math.round(distance * 1000)}m apart)`,
        score: 1 - distance / 0.5,
      });
    }
  }

  // Category match
  if (newBusiness.category_id && existingBusiness.category_id) {
    if (newBusiness.category_id === existingBusiness.category_id) {
      reasons.push({
        type: 'category',
        description: 'Same business category',
        score: 1,
      });
    }
  }

  return reasons;
}

/**
 * Merge two business records
 */
export function mergeBusinessRecords(primary, secondary) {
  // Merge strategy: primary takes precedence, fill gaps from secondary
  return {
    // Use primary name if available, otherwise secondary
    name: primary.name || secondary.name,

    // Use primary category if available
    category_id: primary.category_id || secondary.category_id,
    subcategory_id: primary.subcategory_id || secondary.subcategory_id,
    business_type: primary.business_type || secondary.business_type,

    // Merge address fields
    address: primary.address || secondary.address,
    state: primary.state || secondary.state,
    lga: primary.lga || secondary.lga,
    city: primary.city || secondary.city,
    area: primary.area || secondary.area,

    // Use primary coordinates if available
    latitude: primary.latitude || secondary.latitude,
    longitude: primary.longitude || secondary.longitude,

    // Merge contact fields
    phone: primary.phone || secondary.phone,
    email: primary.email || secondary.email,
    website: primary.website || secondary.website,
    whatsapp: primary.whatsapp || secondary.whatsapp,
    contact_person: primary.contact_person || secondary.contact_person,

    // Merge business details
    opening_hours: primary.opening_hours || secondary.opening_hours,
    description: primary.description || secondary.description,
    logo_url: primary.logo_url || secondary.logo_url,
    cover_url: primary.cover_url || secondary.cover_url,

    // Use primary's verification status
    verification_status: primary.verification_status || secondary.verification_status,

    // Mark as merged
    data_source: 'merged',
  };
}

/**
 * Deduplicate a batch of businesses
 */
export async function deduplicateBatch(businesses, existingBusinesses = []) {
  const results = {
    new: [],
    possible_duplicates: [],
    confirmed_duplicates: [],
  };

  for (const business of businesses) {
    const duplicates = await findPotentialDuplicates(business, [...existingBusinesses, ...results.new]);

    if (duplicates.length === 0) {
      results.new.push(business);
    } else if (duplicates[0].status === 'confirmed') {
      results.confirmed_duplicates.push({
        business,
        duplicate_of: duplicates[0].business,
        score: duplicates[0].score,
        reasons: duplicates[0].reasons,
      });
    } else {
      results.possible_duplicates.push({
        business,
        potential_duplicates: duplicates,
        highest_score: duplicates[0].score,
      });
    }
  }

  return results;
}

export default {
  normalizeBusinessName,
  normalizePhoneNumber,
  normalizeAddress,
  levenshteinDistance,
  calculateSimilarity,
  jaccardSimilarity,
  calculateDuplicateScore,
  classifyDuplicateStatus,
  findPotentialDuplicates,
  getDuplicateReasons,
  mergeBusinessRecords,
  deduplicateBatch,
};
