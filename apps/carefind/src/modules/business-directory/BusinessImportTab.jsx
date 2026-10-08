import { useState, useCallback } from 'react';
import { theme } from '../../styles/theme';
import Button from '@care-ecosystem/design-system/components/ui/Button';
import Card from '@care-ecosystem/design-system/components/ui/Card';
import { useBusinessImport } from './hooks';
import { generateImportTemplate } from './services/importService';

const STEPS = [
  { id: 'upload', label: 'Upload File' },
  { id: 'validate', label: 'Validate' },
  { id: 'preview', label: 'Preview' },
  { id: 'import', label: 'Import' },
  { id: 'complete', label: 'Complete' },
];

export default function BusinessImportTab({ onComplete, onError }) {
  const {
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
  } = useBusinessImport();

  const [duplicateHandling, setDuplicateHandling] = useState('review');
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  }, []);

  const handleFile = (file) => {
    const validTypes = ['text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
    const validExtensions = ['.csv', '.xls', '.xlsx'];
    const extension = '.' + file.name.split('.').pop().toLowerCase();

    if (!validTypes.includes(file.type) && !validExtensions.includes(extension)) {
      onError('Please upload a CSV or Excel file');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      onError('File size must be less than 10MB');
      return;
    }

    uploadFile(file);
  };

  const handleDownloadTemplate = () => {
    const { headers, exampleRow } = generateImportTemplate();
    const csvContent = [headers.join(','), exampleRow.join(',')].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'business_import_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleNextStep = async () => {
    try {
      if (step === 'validate') {
        await parseFile();
      } else if (step === 'preview') {
        await validateRecords();
      } else if (step === 'import') {
        const result = await startImport({ duplicateHandling });
        if (onComplete) onComplete(result);
      }
    } catch (err) {
      onError(err.message);
    }
  };

  const renderStepContent = () => {
    switch (step) {
      case 'upload':
        return (
          <div
            style={{
              ...styles.dropzone,
              ...(dragActive ? styles.dropzoneActive : {}),
            }}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <UploadIcon />
            <p style={styles.dropzoneText}>
              Drag and drop your CSV or Excel file here
            </p>
            <p style={styles.dropzoneSubtext}>or</p>
            <label style={styles.fileInputLabel}>
              <input
                type="file"
                accept=".csv,.xls,.xlsx"
                onChange={(e) => handleFile(e.target.files[0])}
                style={styles.fileInput}
              />
              <Button variant="outline" size="sm">
                Browse Files
              </Button>
            </label>
            <p style={styles.fileInfo}>Maximum file size: 10MB</p>
          </div>
        );

      case 'validate':
        return (
          <div style={styles.stepContent}>
            <div style={styles.fileInfoCard}>
              <FileIcon />
              <div>
                <p style={styles.fileName}>{file?.name}</p>
                <p style={styles.fileSize}>
                  {(file?.size / 1024).toFixed(1)} KB
                </p>
              </div>
            </div>
            {isLoading ? (
              <div style={styles.loadingContainer}>
                <div style={styles.spinner} />
                <p>Validating file...</p>
              </div>
            ) : (
              <p style={styles.instruction}>
                Click "Next" to validate the file contents
              </p>
            )}
          </div>
        );

      case 'preview':
        return (
          <div style={styles.stepContent}>
            {validationResult && (
              <>
                <div style={styles.summaryGrid}>
                  <SummaryCard
                    label="Total Records"
                    value={validationResult.totalRecords}
                    color={theme.gray600}
                  />
                  <SummaryCard
                    label="Valid Records"
                    value={validationResult.validCount}
                    color={theme.success || '#10b981'}
                  />
                  <SummaryCard
                    label="Invalid Records"
                    value={validationResult.errorCount}
                    valueColor={validationResult.errorCount > 0 ? theme.danger || '#ef4444' : theme.gray600}
                    color={theme.gray600}
                  />
                </div>

                {validationResult.errors.length > 0 && (
                  <div style={styles.errorsSection}>
                    <h4 style={styles.errorsTitle}>Validation Errors</h4>
                    <div style={styles.errorsList}>
                      {validationResult.errors.slice(0, 10).map((error, index) => (
                        <div key={index} style={styles.errorItem}>
                          <span style={styles.errorRow}>Row {error.rowNumber}</span>
                          <span style={styles.errorMessage}>{error.message}</span>
                        </div>
                      ))}
                      {validationResult.errors.length > 10 && (
                        <p style={styles.moreErrors}>
                          And {validationResult.errors.length - 10} more errors...
                        </p>
                      )}
                    </div>
                  </div>
                )}

                <div style={styles.duplicateSection}>
                  <h4 style={styles.sectionTitle}>Duplicate Handling</h4>
                  <select
                    value={duplicateHandling}
                    onChange={(e) => setDuplicateHandling(e.target.value)}
                    style={styles.select}
                  >
                    <option value="review">Review duplicates before importing</option>
                    <option value="skip">Skip duplicates</option>
                    <option value="import_new">Import all as new</option>
                  </select>
                </div>
              </>
            )}
          </div>
        );

      case 'import':
        return (
          <div style={styles.stepContent}>
            {isLoading ? (
              <div style={styles.loadingContainer}>
                <div style={styles.spinner} />
                <p style={styles.loadingText}>Importing businesses...</p>
                <p style={styles.loadingSubtext}>This may take a few minutes</p>
              </div>
            ) : (
              <p style={styles.instruction}>
                Ready to import {validationResult?.validCount || 0} businesses
              </p>
            )}
          </div>
        );

      case 'complete':
        return (
          <div style={styles.stepContent}>
            {importResult && (
              <>
                <div style={styles.successIcon}>
                  <CheckCircleIcon />
                </div>
                <h3 style={styles.successTitle}>Import Complete!</h3>
                <div style={styles.summaryGrid}>
                  <SummaryCard
                    label="Imported"
                    value={importResult.inserted}
                    color={theme.success || '#10b981'}
                  />
                  <SummaryCard
                    label="Duplicates"
                    value={importResult.duplicates}
                    color={theme.warning || '#f59e0b'}
                  />
                  <SummaryCard
                    label="Errors"
                    value={importResult.insertErrors}
                    color={theme.danger || '#ef4444'}
                  />
                </div>
                <Button variant="primary" onClick={reset} fullWidth>
                  Import Another File
                </Button>
              </>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  const canProceed = () => {
    switch (step) {
      case 'upload':
        return !!file;
      case 'validate':
        return !isLoading;
      case 'preview':
        return validationResult && validationResult.validCount > 0;
      case 'import':
        return !isLoading;
      case 'complete':
        return false;
      default:
        return false;
    }
  };

  return (
    <div style={styles.container}>
      {/* Steps Indicator */}
      <div style={styles.steps}>
        {STEPS.map((s, index) => (
          <div
            key={s.id}
            style={{
              ...styles.step,
              ...(step === s.id ? styles.stepActive : {}),
              ...(STEPS.findIndex((x) => x.id === step) > index
                ? styles.stepCompleted
                : {}),
            }}
          >
            <div style={styles.stepNumber}>
              {STEPS.findIndex((x) => x.id === step) > index ? (
                <CheckIcon />
              ) : (
                index + 1
              )}
            </div>
            <span style={styles.stepLabel}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* Step Content */}
      <Card style={styles.contentCard}>{renderStepContent()}</Card>

      {/* Error Display */}
      {error && (
        <div style={styles.errorBanner}>
          <AlertIcon />
          <span>{error}</span>
        </div>
      )}

      {/* Actions */}
      <div style={styles.actions}>
        {step !== 'upload' && step !== 'complete' && (
          <Button
            variant="ghost"
            onClick={() => {
              if (step === 'validate') {
                reset();
              } else {
                // Go back to previous step
                const currentIndex = STEPS.findIndex((s) => s.id === step);
                if (currentIndex > 0) {
                  // This is a simplified approach - in reality you'd need to track previous state
                  reset();
                }
              }
            }}
          >
            Back
          </Button>
        )}
        {step !== 'complete' && (
          <Button
            variant="primary"
            onClick={handleNextStep}
            disabled={!canProceed() || isLoading}
            loading={isLoading}
          >
            {step === 'import' ? 'Start Import' : 'Next'}
          </Button>
        )}
      </div>

      {/* Template Download */}
      {step === 'upload' && (
        <div style={styles.templateSection}>
          <p style={styles.templateText}>
            Don't have a file?{' '}
            <button onClick={handleDownloadTemplate} style={styles.templateLink}>
              Download import template
            </button>
          </p>
        </div>
      )}
    </div>
  );
}

// Sub-components
function SummaryCard({ label, value, color, valueColor }) {
  return (
    <div style={styles.summaryCard}>
      <span style={{ ...styles.summaryValue, color: valueColor || color }}>
        {value}
      </span>
      <span style={styles.summaryLabel}>{label}</span>
    </div>
  );
}

// Icons
function UploadIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={theme.gray400} strokeWidth="1.5">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={theme.gray500} strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke={theme.success || '#10b981'} strokeWidth="2">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={theme.danger || '#ef4444'} strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  steps: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '16px',
    background: theme.gray50,
    borderRadius: theme.radius.md,
  },
  step: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: theme.gray400,
  },
  stepActive: {
    color: theme.tealDeep,
  },
  stepCompleted: {
    color: theme.success || '#10b981',
  },
  stepNumber: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: '600',
    border: `2px solid currentColor`,
  },
  stepLabel: {
    fontSize: '13px',
    fontWeight: '500',
  },
  contentCard: {
    padding: '24px',
    minHeight: '300px',
  },
  dropzone: {
    border: `2px dashed ${theme.gray300}`,
    borderRadius: theme.radius.md,
    padding: '48px',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  dropzoneActive: {
    borderColor: theme.tealDeep,
    background: theme.tealMist || '#f0fdfa',
  },
  dropzoneText: {
    fontSize: '16px',
    color: theme.gray600,
    marginTop: '16px',
  },
  dropzoneSubtext: {
    fontSize: '14px',
    color: theme.gray400,
    margin: '8px 0',
  },
  fileInputLabel: {
    cursor: 'pointer',
  },
  fileInput: {
    display: 'none',
  },
  fileInfo: {
    fontSize: '12px',
    color: theme.gray400,
    marginTop: '16px',
  },
  stepContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  fileInfoCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px',
    background: theme.gray50,
    borderRadius: theme.radius.md,
  },
  fileName: {
    fontSize: '14px',
    fontWeight: '500',
    color: theme.gray900,
  },
  fileSize: {
    fontSize: '12px',
    color: theme.gray500,
  },
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    padding: '32px',
  },
  spinner: {
    width: '32px',
    height: '32px',
    border: `3px solid ${theme.gray200}`,
    borderTopColor: theme.tealDeep,
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  loadingText: {
    fontSize: '14px',
    fontWeight: '500',
    color: theme.gray700,
  },
  loadingSubtext: {
    fontSize: '12px',
    color: theme.gray500,
  },
  instruction: {
    fontSize: '14px',
    color: theme.gray600,
    textAlign: 'center',
    padding: '32px',
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '12px',
  },
  summaryCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '16px',
    background: theme.gray50,
    borderRadius: theme.radius.md,
  },
  summaryValue: {
    fontSize: '24px',
    fontWeight: '700',
  },
  summaryLabel: {
    fontSize: '12px',
    color: theme.gray500,
    marginTop: '4px',
  },
  errorsSection: {
    marginTop: '16px',
  },
  errorsTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: theme.gray900,
    marginBottom: '8px',
  },
  errorsList: {
    maxHeight: '200px',
    overflow: 'auto',
    border: `1px solid ${theme.gray200}`,
    borderRadius: theme.radius.md,
  },
  errorItem: {
    display: 'flex',
    gap: '12px',
    padding: '8px 12px',
    borderBottom: `1px solid ${theme.gray100}`,
    fontSize: '13px',
  },
  errorRow: {
    fontWeight: '500',
    color: theme.gray600,
    minWidth: '60px',
  },
  errorMessage: {
    color: theme.danger || '#ef4444',
  },
  moreErrors: {
    padding: '8px 12px',
    fontSize: '12px',
    color: theme.gray500,
    textAlign: 'center',
  },
  duplicateSection: {
    marginTop: '16px',
  },
  sectionTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: theme.gray900,
    marginBottom: '8px',
  },
  select: {
    width: '100%',
    padding: '10px 12px',
    border: `1px solid ${theme.gray200}`,
    borderRadius: theme.radius.md,
    fontSize: '14px',
    color: theme.gray700,
    background: 'white',
  },
  successIcon: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '16px',
  },
  successTitle: {
    fontSize: '20px',
    fontWeight: '600',
    color: theme.gray900,
    textAlign: 'center',
    marginBottom: '16px',
  },
  errorBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px',
    background: '#fef2f2',
    border: `1px solid #fecaca`,
    borderRadius: theme.radius.md,
    color: theme.danger || '#ef4444',
    fontSize: '13px',
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
  },
  templateSection: {
    textAlign: 'center',
    padding: '16px',
  },
  templateText: {
    fontSize: '13px',
    color: theme.gray500,
  },
  templateLink: {
    color: theme.tealDeep,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textDecoration: 'underline',
  },
};
