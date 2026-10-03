import { describe, it, expect } from 'vitest';
import {
  normalizeBusinessName,
  normalizePhoneNumber,
  calculateSimilarity,
  classifyDuplicateStatus,
} from '../services/deduplicationService';

describe('deduplicationService', () => {
  describe('normalizeBusinessName', () => {
    it('removes common prefixes', () => {
      expect(normalizeBusinessName('The Pharmacy')).toBe('pharmacy');
      expect(normalizeBusinessName('A Hospital')).toBe('hospital');
    });

    it('removes punctuation and collapses whitespace', () => {
      expect(normalizeBusinessName('St.  Mary\'s  Clinic')).toBe('st marys clinic');
    });

    it('handles null/empty input', () => {
      expect(normalizeBusinessName(null)).toBe('');
      expect(normalizeBusinessName('')).toBe('');
    });
  });

  describe('normalizePhoneNumber', () => {
    it('normalizes Nigerian phone numbers', () => {
      expect(normalizePhoneNumber('+234 801 234 5678')).toBe('08012345678');
      expect(normalizePhoneNumber('2348012345678')).toBe('08012345678');
      expect(normalizePhoneNumber('08012345678')).toBe('08012345678');
    });

    it('handles null/empty input', () => {
      expect(normalizePhoneNumber(null)).toBe('');
      expect(normalizePhoneNumber('')).toBe('');
    });
  });

  describe('calculateSimilarity', () => {
    it('returns 1 for identical strings', () => {
      expect(calculateSimilarity('pharmacy', 'pharmacy')).toBe(1);
    });

    it('returns 0 for completely different strings', () => {
      expect(calculateSimilarity('abc', 'xyz')).toBeLessThan(0.5);
    });

    it('returns high score for similar strings', () => {
      expect(calculateSimilarity('pharmacy', 'pharmacies')).toBeGreaterThanOrEqual(0.7);
    });

    it('handles null input', () => {
      expect(calculateSimilarity(null, 'test')).toBe(0);
      expect(calculateSimilarity('test', null)).toBe(0);
    });
  });

  describe('classifyDuplicateStatus', () => {
    it('classifies high scores as confirmed', () => {
      expect(classifyDuplicateStatus(0.95)).toBe('confirmed');
    });

    it('classifies medium scores as possible', () => {
      expect(classifyDuplicateStatus(0.75)).toBe('possible');
    });

    it('classifies low scores as new', () => {
      expect(classifyDuplicateStatus(0.5)).toBe('new');
    });
  });
});
