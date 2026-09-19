/**
 * Query Parser Service
 * Parses natural language queries into structured search parameters
 */

/**
 * Category keywords mapping
 */
const CATEGORY_KEYWORDS = {
  pharmacy: ['pharmacy', 'pharmacies', 'drug', 'drugs', 'medicine', 'medicines', 'chemist'],
  hospital: ['hospital', 'hospitals', 'medical centre', 'medical center'],
  clinic: ['clinic', 'clinics', 'medical clinic'],
  'diagnostic centre': ['diagnostic', 'diagnostics', 'lab', 'laboratory', 'testing'],
  'medical laboratory': ['laboratory', 'lab', 'medical lab', 'pathology'],
  'imaging/radiology centre': ['imaging', 'radiology', 'x-ray', 'xray', 'scan', 'ultrasound'],
  'dental clinic': ['dental', 'dentist', 'teeth', 'tooth'],
  'eye clinic/optometry': ['eye', 'optometry', 'optician', 'glasses', 'vision', 'ophthalmology'],
  physiotherapy: ['physiotherapy', 'physio', 'rehabilitation', 'rehab', 'therapy'],
  maternity: ['maternity', 'pregnancy', 'antenatal', 'antenatal', 'birth'],
  paediatric: ['paediatric', 'pediatric', 'children', 'child', 'kids'],
  cardiology: ['cardiology', 'heart', 'cardiac'],
  fertility: ['fertility', 'ivf', 'infertility', 'reproductive'],
  gynecology: ['gynecology', 'gynaecology', 'women health'],
  dermatology: ['dermatology', 'skin', 'dermatologist'],
  'pharmaceutical manufacturer': ['manufacturer', 'manufacturing', 'production'],
  'pharmaceutical distributor': ['distributor', 'distribution', 'wholesale'],
  'medical equipment': ['equipment', 'medical equipment', 'devices'],
  cosmetics: ['cosmetic', 'cosmetics', 'beauty', 'aesthetic'],
};

/**
 * Location keywords
 */
const LOCATION_KEYWORDS = {
  near: ['near', 'around', 'close to', 'nearby', 'in the vicinity of'],
  in: ['in', 'at', 'within', 'inside'],
  around: ['around', "around me", 'surrounding'],
  from: ['from', 'away from'],
};

/**
 * Radius patterns
 */
const RADIUS_PATTERNS = [
  { pattern: /(\d+)\s*km/i, unit: 'km' },
  { pattern: /(\d+)\s*kilometers?/i, unit: 'km' },
  { pattern: /(\d+)\s*meters?/i, unit: 'm' },
  { pattern: /(\d+)\s*m\b/i, unit: 'm' },
  { pattern: /within\s+(\d+)/i, unit: 'km' },
  { pattern: /less than\s+(\d+)\s*km/i, unit: 'km' },
];

/**
 * Quantity patterns
 */
const QUANTITY_PATTERNS = [
  { pattern: /show\s+me\s+(\d+)/i },
  { pattern: /find\s+(\d+)/i },
  { pattern: /get\s+(\d+)/i },
  { pattern: /(\d+)\s+(?:pharmacies|hospitals|clinics|businesses)/i },
  { pattern: /top\s+(\d+)/i },
  { pattern: /first\s+(\d+)/i },
];

/**
 * Extract category from query
 */
export function extractCategory(query) {
  const lowerQuery = query.toLowerCase();

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lowerQuery.includes(keyword)) {
        return {
          category,
          keyword,
          confidence: calculateKeywordConfidence(lowerQuery, keyword),
        };
      }
    }
  }

  return null;
}

/**
 * Calculate keyword confidence based on context
 */
function calculateKeywordConfidence(query, keyword) {
  let confidence = 0.5; // Base confidence

  // Boost if keyword is prominent (not buried in text)
  const keywordIndex = query.indexOf(keyword);
  if (keywordIndex < 10) confidence += 0.2;
  if (keywordIndex < 5) confidence += 0.1;

  // Boost if keyword is a significant portion of the query
  if (keyword.length / query.length > 0.3) confidence += 0.1;

  // Boost if query is short (keyword is more likely the main subject)
  if (query.split(' ').length < 5) confidence += 0.1;

  return Math.min(confidence, 1);
}

/**
 * Extract location from query
 */
export function extractLocation(query) {
  const lowerQuery = query.toLowerCase();

  // Check for "near me" / "around me"
  if (/\b(near|around|close to)\s+me\b/i.test(lowerQuery)) {
    return {
      type: 'current_location',
      description: 'Current location',
      useCurrentLocation: true,
    };
  }

  // Check for location patterns
  const locationPatterns = [
    // "in [location]"
    /(?:in|at)\s+([a-zA-Z\s]+?)(?:\s+(?:within|around|near|,|\?|$))/i,
    // "around [location]"
    /around\s+([a-zA-Z\s]+?)(?:\s+(?:within|near|,|\?|$))/i,
    // "near [location]"
    /near\s+([a-zA-Z\s]+?)(?:\s+(?:within|,|\?|$))/i,
    // "[location] area"
    /([a-zA-Z\s]+?)\s+area/i,
    // "[location] surroundings"
    /([a-zA-Z\s]+?)\s+surroundings/i,
  ];

  for (const pattern of locationPatterns) {
    const match = lowerQuery.match(pattern);
    if (match && match[1]) {
      const location = match[1].trim();
      // Filter out common non-location words
      const nonLocationWords = ['me', 'here', 'pharmacy', 'hospital', 'clinic', 'find', 'show'];
      if (!nonLocationWords.includes(location.toLowerCase())) {
        return {
          type: 'named_location',
          description: location,
          useCurrentLocation: false,
        };
      }
    }
  }

  // Default to current location if no specific location found
  return {
    type: 'current_location',
    description: 'Current location',
    useCurrentLocation: true,
  };
}

/**
 * Extract radius from query
 */
export function extractRadius(query) {
  const lowerQuery = query.toLowerCase();

  for (const { pattern, unit } of RADIUS_PATTERNS) {
    const match = lowerQuery.match(pattern);
    if (match && match[1]) {
      let value = parseInt(match[1], 10);

      // Convert to km if needed
      if (unit === 'm') {
        value = value / 1000;
      }

      // Validate reasonable range
      if (value > 0 && value <= 100) {
        return {
          value,
          unit: 'km',
          raw: match[0],
        };
      }
    }
  }

  // Default radius
  return {
    value: 5,
    unit: 'km',
    raw: 'default',
  };
}

/**
 * Extract quantity from query
 */
export function extractQuantity(query) {
  const lowerQuery = query.toLowerCase();

  for (const { pattern } of QUANTITY_PATTERNS) {
    const match = lowerQuery.match(pattern);
    if (match && match[1]) {
      const value = parseInt(match[1], 10);

      // Validate reasonable range
      if (value > 0 && value <= 100) {
        return {
          value,
          raw: match[0],
        };
      }
    }
  }

  // Default quantity
  return {
    value: 20,
    raw: 'default',
  };
}

/**
 * Extract additional filters from query
 */
export function extractFilters(query) {
  const lowerQuery = query.toLowerCase();
  const filters = {};

  // Check for open/closed status
  if (/\b(open|open now|currently open)\b/i.test(lowerQuery)) {
    filters.isOpenNow = true;
  }

  // Check for verified only
  if (/\b(verified|confirmed|trusted)\b/i.test(lowerQuery)) {
    filters.verifiedOnly = true;
  }

  // Check for specific state
  const states = [
    'lagos', 'abuja', 'kano', 'ibadan', 'port harcourt', 'benin city',
    'kaduna', 'jos', 'enugu', 'aba', 'onitsha', 'warri', 'calabar',
  ];

  for (const state of states) {
    if (lowerQuery.includes(state)) {
      filters.state = state.charAt(0).toUpperCase() + state.slice(1);
      break;
    }
  }

  return filters;
}

/**
 * Parse natural language query into structured search parameters
 */
export function parseQuery(query) {
  if (!query || query.trim() === '') {
    return {
      category: null,
      location: { type: 'current_location', useCurrentLocation: true },
      radius: { value: 5, unit: 'km' },
      quantity: { value: 20 },
      filters: {},
      rawQuery: query,
    };
  }

  const category = extractCategory(query);
  const location = extractLocation(query);
  const radius = extractRadius(query);
  const quantity = extractQuantity(query);
  const filters = extractFilters(query);

  return {
    category,
    location,
    radius,
    quantity,
    filters,
    rawQuery: query,
  };
}

/**
 * Generate search suggestions based on partial query
 */
export function generateSuggestions(partialQuery) {
  const suggestions = [];
  const lowerPartial = partialQuery.toLowerCase();

  // Category suggestions
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const keyword of keywords) {
      if (keyword.startsWith(lowerPartial) || lowerPartial.includes(keyword)) {
        suggestions.push({
          type: 'category',
          text: `Find ${keyword}`,
          category,
        });
      }
    }
  }

  // Location suggestions
  const locationSuggestions = [
    'near me',
    'around me',
    'in Lagos',
    'in Abuja',
    'in Ikeja',
    'in Victoria Island',
    'in Surulere',
    'in Yaba',
  ];

  for (const location of locationSuggestions) {
    if (location.startsWith(lowerPartial) || lowerPartial.includes(location)) {
      suggestions.push({
        type: 'location',
        text: `Businesses ${location}`,
        location,
      });
    }
  }

  // Quantity suggestions
  const quantitySuggestions = [
    'Show me 10',
    'Show me 20',
    'Show me 50',
    'Find 10',
    'Find 20',
  ];

  for (const quantity of quantitySuggestions) {
    if (quantity.toLowerCase().startsWith(lowerPartial)) {
      suggestions.push({
        type: 'quantity',
        text: quantity,
      });
    }
  }

  return suggestions.slice(0, 8); // Limit to 8 suggestions
}

/**
 * Validate parsed query
 */
export function validateParsedQuery(parsed) {
  const errors = [];

  if (!parsed.category) {
    errors.push('No category specified. Try adding "pharmacy", "hospital", or "clinic".');
  }

  if (parsed.radius.value > 50) {
    errors.push('Radius too large. Maximum is 50 km.');
  }

  if (parsed.quantity.value > 100) {
    errors.push('Quantity too large. Maximum is 100.');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Build search query string from parsed parameters
 */
export function buildSearchQuery(parsed) {
  const parts = [];

  if (parsed.category) {
    parts.push(parsed.category.category);
  }

  if (parsed.location.type === 'named_location') {
    parts.push(`in ${parsed.location.description}`);
  } else {
    parts.push('near me');
  }

  if (parsed.radius.value !== 5) {
    parts.push(`within ${parsed.radius.value} km`);
  }

  if (parsed.quantity.value !== 20) {
    parts.push(`show ${parsed.quantity.value}`);
  }

  return parts.join(' ');
}

export default {
  extractCategory,
  extractLocation,
  extractRadius,
  extractQuantity,
  extractFilters,
  parseQuery,
  generateSuggestions,
  validateParsedQuery,
  buildSearchQuery,
  CATEGORY_KEYWORDS,
};
