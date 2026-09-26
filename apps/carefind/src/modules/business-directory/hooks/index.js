import { useState, useEffect, useCallback } from 'react';
import { businessDirectoryRepository } from '../repositories/businessDirectoryRepository.js';

/**
 * Hook for searching businesses
 */
export function useBusinessSearch() {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({});
  const [results, setResults] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const search = useCallback(
    async (searchQuery = query, searchFilters = filters, page = 1) => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await businessDirectoryRepository.listBusinesses(
          { ...searchFilters, search: searchQuery },
          { page, limit: pagination.limit }
        );

        setResults(response.data);
        setPagination(response.pagination);
      } catch (err) {
        setError(err.message);
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    },
    [query, filters, pagination.limit]
  );

  const searchNearby = useCallback(
    async (latitude, longitude, radiusKm = 5, categoryId = null) => {
      setIsLoading(true);
      setError(null);

      try {
        const data = await businessDirectoryRepository.searchNearby(
          latitude,
          longitude,
          Math.round(radiusKm * 1000),
          categoryId ? { category_id: categoryId } : {}
        );
        setResults(data);
      } catch (err) {
        setError(err.message);
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const loadMore = useCallback(() => {
    if (pagination.page < pagination.totalPages) {
      search(query, filters, pagination.page + 1);
    }
  }, [query, filters, pagination, search]);

  const refresh = useCallback(() => {
    search(query, filters, 1);
  }, [query, filters, search]);

  return {
    query,
    setQuery,
    filters,
    setFilters,
    results,
    pagination,
    isLoading,
    error,
    search,
    searchNearby,
    loadMore,
    refresh,
  };
}

/**
 * Hook for managing a single business
 */
export function useBusiness(businessId) {
  const [business, setBusiness] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchBusiness = useCallback(async () => {
    if (!businessId) return;

    setIsLoading(true);
    setError(null);

    try {
      const data = await businessDirectoryRepository.getBusinessById(businessId);
      setBusiness(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    fetchBusiness();
  }, [fetchBusiness]);

  const updateBusiness = useCallback(
    async (updates) => {
      try {
        const updated = await businessDirectoryRepository.updateBusiness(businessId, updates);
        setBusiness(updated);
        return updated;
      } catch (err) {
        setError(err.message);
        throw err;
      }
    },
    [businessId]
  );

  const deleteBusiness = useCallback(async () => {
    try {
      await businessDirectoryRepository.deleteBusiness(businessId);
      setBusiness(null);
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, [businessId]);

  return {
    business,
    isLoading,
    error,
    refresh: fetchBusiness,
    updateBusiness,
    deleteBusiness,
  };
}

/**
 * Hook for business import
 */
export function useBusinessImport() {
  const [step, setStep] = useState('upload'); // upload, validate, preview, import, complete
  const [file, setFile] = useState(null);
  const [parsedData, setParsedData] = useState(null);
  const [validationResult, setValidationResult] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const uploadFile = useCallback((selectedFile) => {
    setFile(selectedFile);
    setStep('validate');
    setParsedData(null);
    setValidationResult(null);
    setImportResult(null);
    setError(null);
  }, []);

  const parseFile = useCallback(async () => {
    if (!file) return;

    setIsLoading(true);
    setError(null);

    try {
      const { parseFile: parse } = await import('../services/importService.js');
      const data = await parse(file);
      setParsedData(data);
      setStep('preview');
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [file]);

  const validateRecords = useCallback(async () => {
    if (!parsedData) return;

    setIsLoading(true);
    setError(null);

    try {
      const { validateBatch } = await import('../services/importService.js');
      const result = await validateBatch(parsedData.records);
      setValidationResult(result);
      setStep('import');
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [parsedData]);

  const startImport = useCallback(
    async (options = {}) => {
      if (!parsedData) return;

      setIsLoading(true);
      setError(null);

      try {
        const { importBusinesses } = await import('../services/importService.js');
        const result = await importBusinesses(parsedData.records, options);
        setImportResult(result);
        setStep('complete');
        return result;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [parsedData]
  );

  const reset = useCallback(() => {
    setStep('upload');
    setFile(null);
    setParsedData(null);
    setValidationResult(null);
    setImportResult(null);
    setError(null);
  }, []);

  return {
    step,
    file,
    parsedData,
    validationResult,
    importResult,
    isLoading,
    error,
    uploadFile,
    parseFile,
    validateRecords,
    startImport,
    reset,
  };
}

/**
 * Hook for business export
 */
export function useBusinessExport() {
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState(null);

  const exportData = useCallback(async (businesses, format, options = {}) => {
    setIsExporting(true);
    setError(null);

    try {
      const { exportBusinesses } = await import('../services/exportService.js');
      const result = exportBusinesses(businesses, format, options);
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsExporting(false);
    }
  }, []);

  return {
    exportData,
    isExporting,
    error,
  };
}

/**
 * Hook for categories
 */
export function useCategories() {
  const [categories, setCategories] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchCategories = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await businessDirectoryRepository.getCategories();
      setCategories(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const getSubcategories = useCallback(async (categoryId) => {
    try {
      return await businessDirectoryRepository.getSubcategories(categoryId);
    } catch (err) {
      setError(err.message);
      return [];
    }
  }, []);

  return {
    categories,
    isLoading,
    error,
    refresh: fetchCategories,
    getSubcategories,
  };
}

/**
 * Hook for location
 */
export function useLocation() {
  const [location, setLocation] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const getCurrentLocation = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const { getCurrentPosition } = await import('../services/locationService.js');
      const pos = await getCurrentPosition();
      setLocation(pos);
      return pos;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const geocodeAddress = useCallback(async (address) => {
    setIsLoading(true);
    setError(null);

    try {
      const { geocodeAddress: geocode } = await import('../services/locationService.js');
      const result = await geocode(address);
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    location,
    isLoading,
    error,
    getCurrentLocation,
    geocodeAddress,
  };
}
