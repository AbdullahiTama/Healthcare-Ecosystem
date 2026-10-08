import { describe, it, expect } from 'vitest';
import {
  extractCategory,
  extractLocation,
  extractRadius,
  extractQuantity,
  parseQuery,
} from '../services/queryParser';

describe('queryParser', () => {
  describe('extractCategory', () => {
    it('extracts pharmacy', () => {
      const result = extractCategory('Find pharmacies around me');
      expect(result).not.toBeNull();
      expect(result.category).toBe('pharmacy');
    });

    it('extracts hospital', () => {
      const result = extractCategory('Find hospitals within 5 km');
      expect(result).not.toBeNull();
      expect(result.category).toBe('hospital');
    });

    it('extracts diagnostic centre', () => {
      const result = extractCategory('Find diagnostic centres near Ikeja');
      expect(result).not.toBeNull();
      expect(result.category).toBe('diagnostic centre');
    });

    it('returns null for unrecognized category', () => {
      const result = extractCategory('Find something random');
      expect(result).toBeNull();
    });
  });

  describe('extractLocation', () => {
    it('detects "near me"', () => {
      const result = extractLocation('Find pharmacies near me');
      expect(result.useCurrentLocation).toBe(true);
    });

    it('extracts named location', () => {
      const result = extractLocation('Find pharmacies in Ikeja within 5km');
      expect(result.type).toBe('named_location');
      expect(result.description).toBe('ikeja');
    });

    it('defaults to current location', () => {
      const result = extractLocation('Find pharmacies');
      expect(result.useCurrentLocation).toBe(true);
    });
  });

  describe('extractRadius', () => {
    it('extracts km radius', () => {
      const result = extractRadius('within 10 km');
      expect(result.value).toBe(10);
      expect(result.unit).toBe('km');
    });

    it('extracts meter radius and converts', () => {
      const result = extractRadius('within 500 meters');
      expect(result.value).toBe(0.5);
    });

    it('defaults to 5 km', () => {
      const result = extractRadius('find pharmacies');
      expect(result.value).toBe(5);
    });
  });

  describe('extractQuantity', () => {
    it('extracts "show me 20"', () => {
      const result = extractQuantity('Show me 20 pharmacies');
      expect(result.value).toBe(20);
    });

    it('extracts "find 10"', () => {
      const result = extractQuantity('Find 10 hospitals');
      expect(result.value).toBe(10);
    });

    it('defaults to 20', () => {
      const result = extractQuantity('find pharmacies');
      expect(result.value).toBe(20);
    });
  });

  describe('parseQuery', () => {
    it('parses a full natural language query', () => {
      const result = parseQuery('Find 20 pharmacies within 5 km near me');
      expect(result.category).not.toBeNull();
      expect(result.category.category).toBe('pharmacy');
      expect(result.radius.value).toBe(5);
      expect(result.quantity.value).toBe(20);
    });

    it('handles empty query', () => {
      const result = parseQuery('');
      expect(result.category).toBeNull();
      expect(result.location.useCurrentLocation).toBe(true);
    });

    it('handles null query', () => {
      const result = parseQuery(null);
      expect(result.category).toBeNull();
    });
  });
});
