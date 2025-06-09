/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, GenerateContentResponse, Content } from '@google/genai';
import * as XLSX from 'xlsx';

// Ensure API key is sourced from process.env
const GEMINI_API_KEY = process.env.API_KEY;
const TEST_DATA_ROW_COUNT = 100;

const GENERIC_EMAIL_DOMAINS = [
  'gmail.com', 'yahoo.com', 'outlook.com', 'aol.com', 'hotmail.com',
  'icloud.com', 'live.com', 'msn.com', 'protonmail.com', 'zoho.com',
  'gmx.com', 'mail.com', 'yandex.com', 'comcast.net', 'verizon.net',
  'att.net', 'sbcglobal.net', 'bellsouth.net', 'cox.net', 'charter.net',
].map(d => d.toLowerCase());

// Pricing Constants for gemini-2.5-flash-preview-04-17 (Paid Tier) - "Flash Model"
const FLASH_PRICE_INPUT_PER_MILLION_TOKENS = 0.15; // USD
const FLASH_PRICE_OUTPUT_THINKING_PER_MILLION_TOKENS = 3.50; // USD
const FLASH_PRICE_GROUNDING_PER_THOUSAND_REQUESTS_AFTER_FREE_TIER = 35; // USD
const FLASH_FREE_GROUNDING_REQUESTS_PER_DAY = 1500;

// Pricing Constants for gemini-2.5-pro-preview-04-17 (Paid Tier, <=200k tokens) - "Pro Model"
const PRO_PRICE_INPUT_PER_MILLION_TOKENS = 1.25; // USD
const PRO_PRICE_OUTPUT_PER_MILLION_TOKENS = 10.00; // USD (includes thinking)


// --- CSV Helper Functions ---
const parseCSV = (csvText: string): string[][] => {
  const lines = csvText.split('\n').filter(line => String(line ?? '').trim() !== '');
  return lines.map(line => {
    const values: string[] = [];
    let currentField = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && i + 1 < line.length && line[i+1] === '"') {
          currentField += '"';
          i++; 
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        values.push(String(currentField ?? '').trim());
        currentField = '';
      } else {
        currentField += char;
      }
    }
    values.push(String(currentField ?? '').trim());
    return values;
  });
};

const stringifyCSV = (data: string[][]): string => {
  return data.map(row =>
    row.map(field => {
      const strField = String(field === null || typeof field === 'undefined' ? '' : field);
      if (strField.includes(',') || strField.includes('\n') || strField.includes('"')) {
        return `"${strField.replace(/"/g, '""')}"`;
      }
      return strField;
    }).join(',')
  ).join('\n');
};
// --- End CSV Helper Functions ---

// --- Domain Extraction Helper ---
const extractDomainFromEmail = (email: string): string | null => {
    if (!email || typeof email !== 'string') return null;
    const atIndex = email.lastIndexOf('@');
    if (atIndex === -1 || atIndex === email.length - 1) return null;
    return email.substring(atIndex + 1).toLowerCase();
};

// --- AI Response Cleanup Helper ---
const cleanAiNotFoundResponses = (data: string[][]): string[][] => {
  if (!data || data.length === 0) return data;

  const notFoundPlaceholders = [
    "url_not_found",
    "no official website found",
    "not found",
    "n/a",
    "null", 
    "undefined",
    "insufficient specific information available on the website to generate a detailed analytical profile for referral matchmaking."
  ].map(p => p.toLowerCase());

  const cleanedData = data.map(row => [...row.map(cell => String(cell ?? ''))]); 

  for (let i = 1; i < cleanedData.length; i++) { 
    const row = cleanedData[i];
    if (row.length > 2) { 
      const cellValue = String(row[2] ?? ''); 
      if (cellValue.trim() !== '') {
        if (notFoundPlaceholders.includes(cellValue.trim().toLowerCase())) {
          row[2] = ""; 
        }
      }
    }
  }
  return cleanedData;
};

// --- URL Normalization for Comparison ---
const normalizeUrlForComparison = (url: string): string => {
  let normalized = String(url ?? '').trim().toLowerCase();
  if (normalized.startsWith('http://')) {
    normalized = normalized.substring(7);
  } else if (normalized.startsWith('https://')) {
    normalized = normalized.substring(8);
  }
  if (normalized.startsWith('www.')) {
    normalized = normalized.substring(4);
  }
  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
};

// --- Plausible URL Check Helper ---
const isPlausibleUrl = (url: string): boolean => {
  const trimmedUrl = String(url ?? '').trim();
  if (trimmedUrl === '') return false;
  if (!trimmedUrl.includes('.')) return false;
  // Avoid treating email addresses as plausible website URLs
  if (trimmedUrl.includes('@') && GENERIC_EMAIL_DOMAINS.some(domain => trimmedUrl.endsWith(domain))) return false;
  if (GENERIC_EMAIL_DOMAINS.some(domain => normalizeUrlForComparison(trimmedUrl) === domain)) return false;
  return true;
};


// --- DataTableDisplay Component ---
interface DataTableDisplayProps {
  data: string[][] | null;
  caption?: string;
}

const DataTableDisplay: React.FC<DataTableDisplayProps> = ({ data, caption }) => {
  if (!data || data.length === 0) {
    return caption ? <p>{caption} - No data to display.</p> : <p>No data to display.</p>;
  }

  const headerRow = data[0];
  const bodyRows = data.slice(1);

  return (
    <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid #ccc', marginBottom: '1rem' }}>
      {caption && <h4 style={{textAlign: 'center', margin: '0.5rem 0'}}>{caption}</h4>}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {headerRow.map((header, index) => (
              <th key={index} style={{ border: '1px solid #ddd', padding: '8px', textAlign: 'left', backgroundColor: '#f2f2f2' }}>
                {String(header ?? '')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyRows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} style={{ border: '1px solid #ddd', padding: '8px' }}>
                  {String(cell ?? '')}
                </td>
              ))}
              {/* Pad rows with fewer cells than header */}
              {row.length < headerRow.length && Array.from({ length: headerRow.length - row.length }).map((_, padIndex) => (
                <td key={`pad-${padIndex}`} style={{ border: '1px solid #ddd', padding: '8px' }}></td>
              ))}
            </tr>
          ))}
           {bodyRows.length === 0 && (
            <tr>
              <td colSpan={headerRow.length} style={{ textAlign: 'center', padding: '8px' }}>
                No data rows.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

interface CurrentOperationStats {
  operationType: 'test_url' | 'full_url' | 'test_dossier' | 'full_dossier' | null;
  status: 'idle' | 'estimating_input' | 'running' | 'completed' | 'error';
  inputTokens: number;
  outputTokens: number;
  apiRequests: number;
  estimatedCost: number;
  modelUsed: string | null;
  progressMessage?: string;
}

const initialCurrentOperationStats: CurrentOperationStats = {
  operationType: null,
  status: 'idle',
  inputTokens: 0,
  outputTokens: 0,
  apiRequests: 0,
  estimatedCost: 0,
  modelUsed: null,
  progressMessage: '',
};

interface PreRunEstimation {
  inputTokens: number;
  apiRequests: number;
  estimatedInputCost: number;
}


const App: React.FC = () => {
  const [csvData, setCsvData] = useState<string[][]>([]);
  const [displayData, setDisplayData] = useState<string>('');
  const [fileName, setFileName] = useState<string>('edited_data.csv');
  const [rawContactsSheetData, setRawContactsSheetData] = useState<string[][] | null>(null);
  const [displayableCorrectedContactsData, setDisplayableCorrectedContactsData] = useState<string[][] | null>(null);
  
  const [isLoading, setIsLoading] = useState<boolean>(false); // Primarily for URL finding full run
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [activityLog, setActivityLog] = useState<string[]>([]);
  const [aiGroundingSources, setAiGroundingSources] = useState<any[]>([]);
  const activityLogRef = useRef<HTMLTextAreaElement>(null);

  // Test states
  const [originalContactsSampleForCorrectionTestDisplay, setOriginalContactsSampleForCorrectionTestDisplay] = useState<string[][] | null>(null);
  const [correctedContactsTestDataForTable, setCorrectedContactsTestDataForTable] = useState<string[][] | null>(null);
  const [isTestingContactCorrection, setIsTestingContactCorrection] = useState<boolean>(false);
  
  const [preprocessedTestDataForTable, setPreprocessedTestDataForTable] = useState<string[][] | null>(null);
  const [isTestingPreprocessing, setIsTestingPreprocessing] = useState<boolean>(false);
  
  const [deletedPlaceholderDescRowsTestDataForTable, setDeletedPlaceholderDescRowsTestDataForTable] = useState<string[][] | null>(null);
  const [isTestingPlaceholderDescRowDeletion, setIsTestingPlaceholderDescRowDeletion] = useState<boolean>(false);

  const [deletedMostlyEmptyRowsTestDataForTable, setDeletedMostlyEmptyRowsTestDataForTable] = useState<string[][] | null>(null);
  const [isTestingMostlyEmptyRowDeletion, setIsTestingMostlyEmptyRowDeletion] = useState<boolean>(false);

  const [mergedTestDataForTable, setMergedTestDataForTable] = useState<string[][] | null>(null);
  const [isTestingMergingDuplicates, setIsTestingMergingDuplicates] = useState<boolean>(false);
  
  const [aiTestedDataForTable, setAiTestedDataForTable] = useState<string[][] | null>(null); // For URL finding test
  const [isTestingAiOnPreprocessed, setIsTestingAiOnPreprocessed] = useState<boolean>(false); // For URL finding test
  
  const [detailedDescriptionTestOutput, setDetailedDescriptionTestOutput] = useState<string | null>(null);
  const [isTestingDescriptionGeneration, setIsTestingDescriptionGeneration] = useState<boolean>(false);

  // Full processing states
  const [isProcessingContactsFull, setIsProcessingContactsFull] = useState<boolean>(false);
  const [isPerformingFullPlaceholderDescRowDeletion, setIsPerformingFullPlaceholderDescRowDeletion] = useState<boolean>(false);
  const [isPerformingFullMostlyEmptyRowDeletion, setIsPerformingFullMostlyEmptyRowDeletion] = useState<boolean>(false);
  const [isMergingDuplicatesFull, setIsMergingDuplicatesFull] = useState<boolean>(false);
  const [skippedBatchNumbers, setSkippedBatchNumbers] = useState<number[]>([]);
  const [isGeneratingFullDescriptions, setIsGeneratingFullDescriptions] = useState<boolean>(false);

  // Token Counting & Cost Estimation State
  const [preRunEstimation, setPreRunEstimation] = useState<PreRunEstimation | null>(null);
  const [isEstimatingCost, setIsEstimatingCost] = useState<boolean>(false);
  const [currentOperationStats, setCurrentOperationStats] = useState<CurrentOperationStats>(initialCurrentOperationStats);

  // Cumulative session stats
  const [totalInputTokens, setTotalInputTokens] = useState<number>(0);
  const [totalOutputTokens, setTotalOutputTokens] = useState<number>(0);
  const [totalApiRequestsMade, setTotalApiRequestsMade] = useState<number>(0); 
  const [estimatedCost, setEstimatedCost] = useState<number>(0); 

  const genAI = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

  const addLog = useCallback((message: string) => {
    setActivityLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  }, []);

  useEffect(() => {
    if (activityLogRef.current) {
      activityLogRef.current.scrollTop = activityLogRef.current.scrollHeight;
    }
  }, [activityLog]);

  const updateDisplayData = (data: string[][], source: string, message?: string) => {
    setCsvData(data); 
    try {
      setDisplayData(JSON.stringify(data, null, 2));
      if (message) {
        setStatusMessage(message);
        if(!source.toLowerCase().includes('test') && !source.toLowerCase().includes('incremental')) addLog(message); 
      } else if (source === 'csv' || source === 'excel') {
        const msg = `${source === 'csv' ? 'CSV' : 'Excel'} data loaded. You can now process it.`;
        setStatusMessage(msg);
        addLog(msg);
      } else if (source === 'ai_url_find') {
        const msg = 'AI URL finding complete for all batches. Review data and download if correct.';
        setStatusMessage(msg);
        addLog(msg);
      } else if (source === 'ai_dossier_gen') {
          const msg = 'AI Dossier generation complete for all rows. Review data and download if correct.';
          setStatusMessage(msg);
          addLog(msg);
      }
    } catch (e) {
      const errorMsg = "Error: Could not display data as JSON.";
      setDisplayData("Error stringifying data.");
      setStatusMessage(errorMsg);
      addLog(`Error stringifying data for display: ${e instanceof Error ? e.message : String(e)}`);
      console.error("Error stringifying data:", e);
    }
  };
  
  const getTokenCountForModel = async (contents: Content[], modelName: 'gemini-2.5-flash-preview-04-17' | 'gemini-2.5-pro-preview-04-17'): Promise<number> => {
    if (!genAI || !contents) return 0;
    try {
      const { totalTokens } = await genAI.models.countTokens({ contents, model: modelName });
      return totalTokens;
    } catch (e) {
      addLog(`Error counting tokens for model ${modelName}: ${e instanceof Error ? e.message : String(e)}`);
      console.error(`Error counting tokens for model ${modelName}:`, e);
      return 0; 
    }
  };

  const calculateOperationCost = (inputTokens: number, outputTokens: number, apiRequests: number, modelType: 'flash' | 'pro'): number => {
    let inputCost = 0;
    let outputCost = 0;
    if (modelType === 'flash') {
        inputCost = (inputTokens / 1000000) * FLASH_PRICE_INPUT_PER_MILLION_TOKENS;
        outputCost = (outputTokens / 1000000) * FLASH_PRICE_OUTPUT_THINKING_PER_MILLION_TOKENS;
    } else if (modelType === 'pro') {
        inputCost = (inputTokens / 1000000) * PRO_PRICE_INPUT_PER_MILLION_TOKENS;
        outputCost = (outputTokens / 1000000) * PRO_PRICE_OUTPUT_PER_MILLION_TOKENS;
    }
    // Grounding cost is handled cumulatively for now, as it's per day.
    return inputCost + outputCost;
  };
  
  const recalculateCumulativeSessionCost = () => {
    setEstimatedCost(() => { 
      // This function now implicitly sums up costs from different model types as they are added to totals
      const flashInputCost = (totalInputTokens / 1000000) * FLASH_PRICE_INPUT_PER_MILLION_TOKENS; // Example, assuming totals might be mixed
      const flashOutputCost = (totalOutputTokens / 1000000) * FLASH_PRICE_OUTPUT_THINKING_PER_MILLION_TOKENS; // Example
      // A more precise cumulative cost would require tracking tokens per model type if mixing a lot.
      // For simplicity, if we assume most tokens are of one type or average out:
      // Here we'll calculate based on the flash model primarily for grounding context,
      // but individual operation costs are calculated with their specific models.
      // The `estimatedCost` state will reflect the sum of individual operation costs, which is more accurate.
      // So this function might just sum up pre-calculated costs from operations or recalculate based on mixed totals.
      // Let's keep it simple: the main `estimatedCost` will be the sum of each operation's specific cost.
      // This function is now more of a trigger to update the UI if needed, but actual calculation is done per operation.
      // The true cumulative cost is now the sum of individual operation costs, updated in `currentOperationStats.estimatedCost` accumulation.
      // Let's refine this: The `estimatedCost` will be directly the sum of the `currentOperationStats.estimatedCost` from each operation.
      // So, this recalculate function isn't as central for the *total* as before, but good for grounding.
      let groundingCost = 0;
      if (totalApiRequestsMade > FLASH_FREE_GROUNDING_REQUESTS_PER_DAY) { // Grounding is tied to Flash model for URL finding
          groundingCost = ((totalApiRequestsMade - FLASH_FREE_GROUNDING_REQUESTS_PER_DAY) / 1000) * FLASH_PRICE_GROUNDING_PER_THOUSAND_REQUESTS_AFTER_FREE_TIER;
      }
      // The main 'estimatedCost' is the sum of individual op costs, so no need to recalculate here based on total tokens.
      // This function can now be more about updating the UI if there are other elements to refresh.
      // For now, the cost update happens with each operation's completion.
      // To ensure the UI reflects the sum of operation costs for the session:
      // We will sum up the *actual* costs of each operation rather than recalculating from total tokens.
      // This state `estimatedCost` needs to be an accumulation of costs from `currentOperationStats`.
      // The logic for this accumulation will be at the end of each main AI handler.
      return estimatedCost + groundingCost; // This still needs refinement, current `estimatedCost` is already sum.
                                      // Best to calculate grounding separately and add to the displayed total.
    });
  };
  

  const correctContactSheetAccountAssignments = useCallback((originalContactsData: string[][]): string[][] => {
    addLog("Starting Contact Sheet Account Correction process.");
    if (!originalContactsData || originalContactsData.length < 2) {
        addLog("Contact sheet is empty or has no data rows. Skipping correction.");
        return originalContactsData.map(row => row.map(cell => String(cell ?? '')));
    }

    const domainToOrgNameMap = new Map<string, string>();
    const contactsHeader = originalContactsData[0].map(cell => String(cell ?? ''));
    const contactsBody = originalContactsData.slice(1).map(row => row.map(cell => String(cell ?? '')));
    let correctionsMade = 0;

    addLog("Contact Correction - Pass 1: Building domain-to-organization map.");
    contactsBody.forEach((contactRow) => {
        const email = String(contactRow[3] ?? '').trim(); 
        const accountCell = String(contactRow[9] ?? '').trim(); 

        if (email && accountCell) {
            const domain = extractDomainFromEmail(email);
            if (domain && !GENERIC_EMAIL_DOMAINS.includes(domain)) {
                if (accountCell.toLowerCase().startsWith("accounts::::")) {
                    const orgNameFromCell = accountCell.substring("accounts::::".length).trim();
                    if (orgNameFromCell) {
                        if (!domainToOrgNameMap.has(domain)) {
                            domainToOrgNameMap.set(domain, orgNameFromCell);
                        }
                    }
                }
            }
        }
    });
    addLog(`Contact Correction - Pass 1: Map built with ${domainToOrgNameMap.size} domain entries.`);

    addLog("Contact Correction - Pass 2: Applying corrections to contacts sheet.");
    const correctedContactsBody = contactsBody.map(row => [...row.map(cell => String(cell ?? ''))]); 

    correctedContactsBody.forEach((contactRowToCorrect, index) => {
        const email = String(contactRowToCorrect[3] ?? '').trim(); 
        if (email) {
            const domain = extractDomainFromEmail(email);
            if (domain && domainToOrgNameMap.has(domain)) {
                const correctOrgName = domainToOrgNameMap.get(domain)!;
                const expectedAccountCellValue = "Accounts::::" + correctOrgName;
                
                while (contactRowToCorrect.length < 10) contactRowToCorrect.push('');
                const currentAccountCell = String(contactRowToCorrect[9] ?? '').trim();

                if (currentAccountCell.toLowerCase() !== expectedAccountCellValue.toLowerCase()) {
                    const oldValue = contactRowToCorrect[9] || '';
                    contactRowToCorrect[9] = expectedAccountCellValue;
                    const contactName = `${String(contactRowToCorrect[1] ?? '').trim()} ${String(contactRowToCorrect[2] ?? '').trim()}`.trim() || `contact at row ${index + 2}`;
                    addLog(`Contact Correction: Updated account for ${contactName} (email: ${email}) from '${oldValue}' to '${expectedAccountCellValue}'.`);
                    correctionsMade++;
                }
            }
        }
    });

    addLog(`Contact Sheet Account Correction process complete. ${correctionsMade} corrections applied.`);
    return [contactsHeader, ...correctedContactsBody];
  }, [addLog]);

  const prefillUrlsFromContacts = useCallback((orgsData: string[][], contactsData: string[][]): { updatedOrgsData: string[][], prefilledCount: number } => {
    addLog("Starting URL pre-fill process from contacts sheet.");
    let prefilledCount = 0;
    const updatedOrgsData = orgsData.map(orgRow => orgRow.map(cell => String(cell ?? ''))); 

    if (updatedOrgsData.length > 0) {
        const header = updatedOrgsData[0];
        while (header.length < 3) header.push(''); 
        if (String(header[2] ?? '').trim() === '') {
            header[2] = "Website URL"; 
            addLog("Added 'Website URL' header to column C of organizations sheet for pre-fill.");
        }
    }

    for (let i = 1; i < updatedOrgsData.length; i++) { 
        const orgRow = updatedOrgsData[i];
        const orgName = String(orgRow[0] ?? '').trim().toLowerCase();
        if (!orgName) continue;

        while (orgRow.length < 3) orgRow.push('');
        
        if (isPlausibleUrl(String(orgRow[2] ?? ''))) { 
             const existingUrlDomain = normalizeUrlForComparison(String(orgRow[2] ?? ''));
             // Ensure that we don't overwrite a plausible non-generic domain with a generic one
             if (existingUrlDomain && !GENERIC_EMAIL_DOMAINS.some(genDomain => existingUrlDomain.endsWith(genDomain))) { 
                 addLog(`Skipping pre-fill for "${orgRow[0]}" as plausible non-generic URL already exists: "${orgRow[2]}"`);
                 continue;
            }
        }

        for (const contactRow of contactsData.slice(1)) { 
            const accountCell = String(contactRow[9] ?? '').trim();
            if (accountCell && accountCell.toLowerCase().startsWith("accounts::::")) {
                const contactOrgName = accountCell.substring("accounts::::".length).trim().toLowerCase();
                if (contactOrgName === orgName) {
                    const email = String(contactRow[3] ?? '').trim();
                    if (email) {
                        const domain = extractDomainFromEmail(email);
                        if (domain) {
                            if (GENERIC_EMAIL_DOMAINS.includes(domain)) {
                                addLog(`Skipped pre-filling URL for "${orgRow[0]}" from contact email "${email}" because domain "${domain}" is generic.`);
                            } else {
                                orgRow[2] = domain; 
                                prefilledCount++;
                                addLog(`Pre-filled URL for "${orgRow[0]}" with "${domain}" from contacts sheet.`);
                                break; 
                            }
                        }
                    }
                }
            }
        }
    }
    addLog(`URL pre-fill process complete. ${prefilledCount} URLs were pre-filled from contacts.`);
    return { updatedOrgsData, prefilledCount };
  }, [addLog]);

  const performPlaceholderDescRowDeletionLogic = useCallback((inputData: string[][], context: string): { cleanedData: string[][], rowsBefore: number, rowsDeleted: number } => {
    addLog(`Placeholder Row Deletion (${context}): Starting deletion process.`);
    if (!inputData || inputData.length < 2) {
        addLog(`Placeholder Row Deletion (${context}): No data or only header row. Nothing to delete.`);
        return { cleanedData: inputData.map(row => row.map(cell => String(cell ?? ''))), rowsBefore: inputData.length > 0 ? inputData.length -1 : 0, rowsDeleted: 0 };
    }
    const headerRow = inputData[0].map(cell => String(cell ?? ''));
    const dataRows = inputData.slice(1).map(row => row.map(cell => String(cell ?? '')));
    const rowsBefore = dataRows.length;
    const DESCRIPTION_COL_INDEX = 63; 
    const placeholderText = "Insufficient specific information available on the website to generate a detailed analytical profile for referral matchmaking.".toLowerCase();
    
    const keptRows = dataRows.filter(row => {
        const orgName = String(row[0] ?? '').trim();
        if (!orgName) return true; 
        
        const description = (row.length > DESCRIPTION_COL_INDEX ? String(row[DESCRIPTION_COL_INDEX] ?? '') : '').trim().toLowerCase();
        if (description === placeholderText) {
            addLog(`Placeholder Row Deletion (${context}): Deleting row for "${orgName}" due to placeholder description.`);
            return false;
        }
        return true; 
    });

    const cleanedData = [headerRow, ...keptRows];
    const rowsDeleted = rowsBefore - keptRows.length;
    addLog(`Placeholder Row Deletion (${context}): Process complete. Rows before: ${rowsBefore}, Rows after: ${keptRows.length}. Deleted ${rowsDeleted} rows.`);
    return { cleanedData, rowsBefore, rowsDeleted };
  }, [addLog]);

  const performMostlyEmptyRowsLogic = useCallback((inputData: string[][], context: string): { cleanedData: string[][], rowsBefore: number, rowsDeleted: number } => {
    addLog(`Mostly Empty Row Deletion (${context}): Starting deletion process.`);
     if (!inputData || inputData.length < 2) {
        addLog(`Mostly Empty Row Deletion (${context}): No data or only header row. Nothing to delete.`);
        return { cleanedData: inputData.map(row => row.map(cell => String(cell ?? ''))), rowsBefore: inputData.length > 0 ? inputData.length -1 : 0, rowsDeleted: 0 };
    }
    const headerRow = inputData[0].map(cell => String(cell ?? ''));
    const dataRows = inputData.slice(1).map(row => row.map(cell => String(cell ?? '')));
    const rowsBefore = dataRows.length;
    const DESCRIPTION_COL_INDEX = 63; 
    const ORG_NAME_COL_INDEX = 0; 

    const keptRows = dataRows.filter(row => {
        const orgName = String(row[ORG_NAME_COL_INDEX] ?? '').trim();
        if (!orgName) return true; 

        let allOtherCellsEmpty = true;
        for (let i = 0; i < row.length; i++) {
            if (i === ORG_NAME_COL_INDEX || i === DESCRIPTION_COL_INDEX) {
                continue; 
            }
            if (String(row[i] ?? '').trim() !== '') { 
                allOtherCellsEmpty = false;
                break;
            }
        }
        
        if (allOtherCellsEmpty) {
            addLog(`Mostly Empty Row Deletion (${context}): Deleting row for "${orgName}" as other fields (excluding description) are empty.`);
            return false; 
        }
        return true; 
    });

    const cleanedData = [headerRow, ...keptRows];
    const rowsDeleted = rowsBefore - keptRows.length;
    addLog(`Mostly Empty Row Deletion (${context}): Process complete. Rows before: ${rowsBefore}, Rows after: ${keptRows.length}. Deleted ${rowsDeleted} rows.`);
    return { cleanedData, rowsBefore, rowsDeleted };
  }, [addLog]);

  const performMergeDuplicatesLogic = useCallback((inputData: string[][], context: string): { mergedData: string[][], rowsBefore: number, rowsAfter: number } => {
    addLog(`Merge Duplicates (${context}): Starting merge process.`);
    if (!inputData || inputData.length < 2) {
      addLog(`Merge Duplicates (${context}): No data or only header row. Nothing to merge.`);
      return { mergedData: inputData.map(row => row.map(cell => String(cell ?? ''))), rowsBefore: inputData.length > 0 ? inputData.length -1 : 0, rowsAfter: inputData.length > 0 ? inputData.length -1 : 0 };
    }

    const headerRowOriginal = inputData[0].map(cell => String(cell ?? ''));
    const dataRows = inputData.slice(1).map(row => row.map(cell => String(cell ?? '')));
    const rowsBeforeProcessing = dataRows.length;

    const DESCRIPTION_COL_INDEX = 63;
    const URL_COL_INDEX = 2;
    const ORG_NAME_COL_INDEX = 0;

    const groupedByOrgNameLC = new Map<string, string[][]>();
    dataRows.forEach(row => {
      const orgNameLC = String(row[ORG_NAME_COL_INDEX] ?? '').trim().toLowerCase();
      if (!orgNameLC) return; // Skip rows with no organization name for grouping
      if (!groupedByOrgNameLC.has(orgNameLC)) {
        groupedByOrgNameLC.set(orgNameLC, []);
      }
      groupedByOrgNameLC.get(orgNameLC)!.push(row);
    });

    const finalMergedDataRows: string[][] = [];

    groupedByOrgNameLC.forEach((group, _orgNameKeyLC) => {
      if (group.length === 1) {
        finalMergedDataRows.push(group[0]);
        return;
      }

      const originalOrgNameFromFirstRow = String(group[0][ORG_NAME_COL_INDEX] ?? '').trim();
      addLog(`Merge Duplicates (${context}): Processing group for "${originalOrgNameFromFirstRow}" (${group.length} rows)`);

      let bestRawUrl = '';
      let bestDescription = '';
      let representativeRowData = [...group[0]]; // Default representative, use a copy

      // Determine best URL from the group
      let longestUrlLength = -1;
      let hasPlausibleUrl = false;
      group.forEach(currentRow => {
        const currentRawUrlString = String(currentRow.length > URL_COL_INDEX ? currentRow[URL_COL_INDEX] : '').trim();
        if (isPlausibleUrl(currentRawUrlString)) {
          hasPlausibleUrl = true;
          if (currentRawUrlString.length > longestUrlLength) {
            bestRawUrl = currentRawUrlString;
            longestUrlLength = currentRawUrlString.length;
          }
        } else if (!hasPlausibleUrl && currentRawUrlString.length > longestUrlLength) {
          // If no plausible URL found yet, consider longest non-empty even if not "plausible" by strict check,
          // but plausible ones will always win.
          bestRawUrl = currentRawUrlString;
          longestUrlLength = currentRawUrlString.length;
        }
      });
      
      // Determine best Description from the group
      let longestDescLength = -1;
      group.forEach(currentRow => {
        const currentDesc = String(currentRow.length > DESCRIPTION_COL_INDEX ? currentRow[DESCRIPTION_COL_INDEX] : '').trim();
        if (currentDesc.length > longestDescLength) {
          bestDescription = currentDesc;
          longestDescLength = currentDesc.length;
        }
      });
      
      // Determine representative row based on who contributed the best description, then best URL
      let representativeChosen = false;
      if (bestDescription !== '') {
          for (const currentRow of group) {
              if (String(currentRow.length > DESCRIPTION_COL_INDEX ? currentRow[DESCRIPTION_COL_INDEX] : '').trim() === bestDescription) {
                  representativeRowData = [...currentRow];
                  representativeChosen = true;
                  break;
              }
          }
      }
      if (!representativeChosen && bestRawUrl !== '') {
          for (const currentRow of group) {
              if (String(currentRow.length > URL_COL_INDEX ? currentRow[URL_COL_INDEX] : '').trim() === bestRawUrl) {
                  representativeRowData = [...currentRow];
                  representativeChosen = true;
                  break;
              }
          }
      }
      // If still not chosen (e.g. all descriptions empty, all URLs empty or identical non-plausible), group[0] is representative

      const mergedRowOutput = [...representativeRowData];
      const requiredLength = Math.max(headerRowOriginal.length, DESCRIPTION_COL_INDEX + 1, URL_COL_INDEX + 1, ORG_NAME_COL_INDEX + 1);
      
      while(mergedRowOutput.length < requiredLength) mergedRowOutput.push('');
      
      mergedRowOutput[ORG_NAME_COL_INDEX] = originalOrgNameFromFirstRow; // Preserve original casing of org name
      mergedRowOutput[URL_COL_INDEX] = bestRawUrl;
      mergedRowOutput[DESCRIPTION_COL_INDEX] = bestDescription;
  
      finalMergedDataRows.push(mergedRowOutput);
      addLog(`Merge Duplicates (${context}): Merged rows for "${originalOrgNameFromFirstRow}". Result URL: "${bestRawUrl}", Desc (start): "${bestDescription.substring(0,30)}..."`);
    });
    
    let maxCols = headerRowOriginal.length;
    finalMergedDataRows.forEach(row => { maxCols = Math.max(maxCols, row.length); });

    const fullyPaddedHeader = [...headerRowOriginal];
    while(fullyPaddedHeader.length < maxCols) fullyPaddedHeader.push('');

    const fullyPaddedMergedDataRows = finalMergedDataRows.map(row => {
        const newRow = [...row.map(cell => String(cell ?? ''))]; // Ensure all cells are strings
        while (newRow.length < maxCols) newRow.push('');
        return newRow;
    });

    const finalOutputData = [fullyPaddedHeader, ...fullyPaddedMergedDataRows];
    const rowsAfterProcessing = finalMergedDataRows.length;
    addLog(`Merge Duplicates (${context}): Merge process complete. Rows before: ${rowsBeforeProcessing}, Rows after: ${rowsAfterProcessing}.`);
    return { mergedData: finalOutputData, rowsBefore: rowsBeforeProcessing, rowsAfter: rowsAfterProcessing };
  }, [addLog]);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) { setStatusMessage('No file selected.'); addLog('File selection cancelled.'); return; }
    setCsvData([]); setDisplayData(''); setRawContactsSheetData(null); setDisplayableCorrectedContactsData(null);
    setOriginalContactsSampleForCorrectionTestDisplay(null); setCorrectedContactsTestDataForTable(null);
    setPreprocessedTestDataForTable(null); setDeletedPlaceholderDescRowsTestDataForTable(null);
    setDeletedMostlyEmptyRowsTestDataForTable(null); setMergedTestDataForTable(null);
    setAiTestedDataForTable(null); setDetailedDescriptionTestOutput(null); 
    setAiGroundingSources([]);
    setIsProcessingContactsFull(false); setIsPerformingFullPlaceholderDescRowDeletion(false);
    setIsPerformingFullMostlyEmptyRowDeletion(false); setIsMergingDuplicatesFull(false);
    setIsLoading(false); setSkippedBatchNumbers([]); setIsGeneratingFullDescriptions(false);
    setPreRunEstimation(null); setCurrentOperationStats(initialCurrentOperationStats);
    setTotalInputTokens(0); setTotalOutputTokens(0); setTotalApiRequestsMade(0); setEstimatedCost(0);
    addLog(`File selected: ${file.name} (type: ${file.type}, size: ${file.size} bytes)`);
    const fileExtension = file.name.toLowerCase().split('.').pop();
    if (!['csv', 'xlsx', 'xls'].includes(fileExtension ?? '')) { setStatusMessage('Invalid file type.'); addLog(`Invalid file: ${file.name}.`); return; }
    const baseFileName = file.name.replace(/\.(csv|xlsx|xls)$/i, '');
    setFileName(`${baseFileName}_with_urls.csv`);
    const currentMajorProcessingActive = isLoading || isProcessingContactsFull || isPerformingFullPlaceholderDescRowDeletion || isPerformingFullMostlyEmptyRowDeletion || isMergingDuplicatesFull || isTestingContactCorrection || isTestingPreprocessing || isTestingPlaceholderDescRowDeletion || isTestingMostlyEmptyRowDeletion || isTestingMergingDuplicates || isTestingAiOnPreprocessed || isTestingDescriptionGeneration || isEstimatingCost || isGeneratingFullDescriptions;
    if (currentMajorProcessingActive) { addLog("File change ignored: Process running."); return; }
    let initialLoadingSetter = setIsLoading; initialLoadingSetter(true); // Use main isLoading for file load
    const loadingMsg = `Loading ${file.name}...`; setStatusMessage(loadingMsg); addLog(loadingMsg);
    const reader = new FileReader();
    reader.onload = async (e) => {
      let localOrganizationSheetData: string[][];
      let localContactsSheetDataForProcessing: string[][] | null = null;
      try {
        const fileContent = e.target?.result; if (!fileContent) throw new Error("File content could not be read.");
        if (fileExtension === 'csv') {
          addLog('Parsing CSV...'); localOrganizationSheetData = parseCSV(fileContent as string).map(row => row.map(cell => String(cell ?? '')));
        } else { 
          addLog('Parsing Excel...');
          const workbook = XLSX.read(fileContent as ArrayBuffer, { type: 'array', cellNF: false, cellText: true });
          if (workbook.SheetNames.length === 0) throw new Error("Excel workbook empty.");
          const firstSheetName = workbook.SheetNames[0];
          localOrganizationSheetData = XLSX.utils.sheet_to_json<any[]>(workbook.Sheets[firstSheetName], { header: 1, defval: "" }).map(row => row.map(cell => String(cell ?? '')));
          addLog(`Parsed "${firstSheetName}" with ${localOrganizationSheetData.length} rows.`);
          if (workbook.SheetNames.length > 1) {
            const secondSheetName = workbook.SheetNames[1];
            const rawContactsDataFromExcel = XLSX.utils.sheet_to_json<any[]>(workbook.Sheets[secondSheetName], { header: 1, defval: "" }).map(row => row.map(cell => String(cell ?? '')));
            addLog(`Found "${secondSheetName}" (Contacts) with ${rawContactsDataFromExcel.length} rows.`);
            if (rawContactsDataFromExcel.length > 0) {
                // Store raw sample for "Contact Correction Test"
                const contactsHeaderForSample = rawContactsDataFromExcel[0];
                const contactsBodyForSample = rawContactsDataFromExcel.slice(1, Math.min(rawContactsDataFromExcel.length, TEST_DATA_ROW_COUNT + 1));
                setOriginalContactsSampleForCorrectionTestDisplay([contactsHeaderForSample, ...contactsBodyForSample]);
                addLog(`Stored raw sample of ${contactsBodyForSample.length} contacts for testing.`);
                
                // Correct the *entire* contacts sheet for actual pre-filling and download
                const fullyCorrectedContacts = correctContactSheetAccountAssignments(rawContactsDataFromExcel);
                setRawContactsSheetData(fullyCorrectedContacts); 
                setDisplayableCorrectedContactsData(fullyCorrectedContacts);
                localContactsSheetDataForProcessing = fullyCorrectedContacts;
                addLog(`Contacts sheet corrected. Full corrected version stored for pre-filling and download.`);
            } else { setOriginalContactsSampleForCorrectionTestDisplay(null); setRawContactsSheetData(null); setDisplayableCorrectedContactsData(null); }
          } else { setOriginalContactsSampleForCorrectionTestDisplay(null); setRawContactsSheetData(null); setDisplayableCorrectedContactsData(null); }
        }
        if (localOrganizationSheetData.length === 0 || (localOrganizationSheetData.length === 1 && localOrganizationSheetData[0].every(cell => String(cell ?? '').trim() === ''))) {
            updateDisplayData([], fileExtension === 'csv' ? 'csv' : 'excel', 'Main sheet empty/unparsable.');
        } else {
            if (localContactsSheetDataForProcessing && localContactsSheetDataForProcessing.length > 1) { 
                const { updatedOrgsData, prefilledCount } = prefillUrlsFromContacts(localOrganizationSheetData, localContactsSheetDataForProcessing);
                updateDisplayData(updatedOrgsData, 'contactPrefillInitial', `Parsed ${updatedOrgsData.length} rows. ${prefilledCount} URLs initially pre-filled from corrected contacts.`);
            } else { updateDisplayData(localOrganizationSheetData, fileExtension === 'csv' ? 'csv' : 'excel', `Parsed ${localOrganizationSheetData.length} rows. No contacts pre-fill.`); }
        }
      } catch (err: any) { console.error(`Error processing ${file.name}:`, err); updateDisplayData([], fileExtension === 'csv' ? 'csv' : 'excel', `Error: ${err.message}`);
      } finally { initialLoadingSetter(false); }
    };
    reader.onerror = () => { setStatusMessage(`Error reading file: ${reader.error}`); initialLoadingSetter(false); };
    if (fileExtension === 'csv') reader.readAsText(file); else reader.readAsArrayBuffer(file);
    event.target.value = ''; 
  };
  
  // --- Test Handlers ---
  const handleContactCorrectionTest = () => {
    addLog("Initiating Contact Account Correction Test."); if (!originalContactsSampleForCorrectionTestDisplay || originalContactsSampleForCorrectionTestDisplay.length < 1) { setStatusMessage("Contact Correction Test: No original contacts sample loaded (Excel with 2nd sheet needed)."); addLog("Contact Correction Test: Original sample unavailable."); setCorrectedContactsTestDataForTable(null); return; }
    setIsTestingContactCorrection(true); setStatusMessage(`Contact Correction Test: Processing sample...`); const correctedSample = correctContactSheetAccountAssignments(originalContactsSampleForCorrectionTestDisplay); setCorrectedContactsTestDataForTable(correctedSample);
    setStatusMessage(`Contact Account Correction Test Complete.`); addLog(`Contact Correction Test Complete.`); setIsTestingContactCorrection(false);
  };
  const handlePreprocessingTest = () => { // This is the URL pre-fill test
    addLog("Initiating Pre-processing Test (Step 1 - URL pre-fill from contacts)."); setIsTestingPreprocessing(true); setDeletedPlaceholderDescRowsTestDataForTable(null); setDeletedMostlyEmptyRowsTestDataForTable(null); setMergedTestDataForTable(null); setAiTestedDataForTable(null); setDetailedDescriptionTestOutput(null); let currentDataForTest: string[][]; try { currentDataForTest = JSON.parse(displayData); } catch { setStatusMessage("Pre-processing Test: Invalid JSON in main display area. Cannot proceed."); addLog("Pre-processing Test: Error parsing main display data."); setIsTestingPreprocessing(false); return;} if (currentDataForTest.length < 2) {setStatusMessage("Pre-processing Test: Not enough data in main display."); addLog("Pre-processing Test: Not enough data for test."); setIsTestingPreprocessing(false); return;}
    const testSample = [currentDataForTest[0], ...currentDataForTest.slice(1, Math.min(currentDataForTest.length, TEST_DATA_ROW_COUNT + 1))];
    if (rawContactsSheetData && rawContactsSheetData.length > 1) { const { updatedOrgsData, prefilledCount } = prefillUrlsFromContacts(testSample, rawContactsSheetData); setPreprocessedTestDataForTable(updatedOrgsData); addLog(`Pre-processing Test: ${prefilledCount} URLs pre-filled in the ${updatedOrgsData.length -1} row sample.`); } else { setPreprocessedTestDataForTable(testSample); addLog("Pre-processing Test: No contacts data to pre-fill URLs from in the sample."); }
    setStatusMessage(`Pre-processing Test (URL Pre-fill from Contacts) Complete.`); setIsTestingPreprocessing(false);
  };
  const handlePlaceholderDescRowDeletionTest = () => {
    addLog("Initiating Placeholder Desc Row Deletion Test."); setIsTestingPlaceholderDescRowDeletion(true); setDeletedMostlyEmptyRowsTestDataForTable(null); setMergedTestDataForTable(null); setAiTestedDataForTable(null); setDetailedDescriptionTestOutput(null); let dataToProcess = preprocessedTestDataForTable; if (!dataToProcess) { try { dataToProcess = JSON.parse(displayData); dataToProcess = [dataToProcess![0], ...dataToProcess!.slice(1, Math.min(dataToProcess!.length, TEST_DATA_ROW_COUNT + 1))]; } catch { setStatusMessage("Placeholder Deletion Test: Invalid JSON or previous test result missing."); setIsTestingPlaceholderDescRowDeletion(false); return; } } if (!dataToProcess || dataToProcess.length < 2) { setStatusMessage("Placeholder Deletion Test: Not enough data from previous step."); setIsTestingPlaceholderDescRowDeletion(false); return; }
    const { cleanedData, rowsDeleted } = performPlaceholderDescRowDeletionLogic(dataToProcess, "Test"); setDeletedPlaceholderDescRowsTestDataForTable(cleanedData); addLog(`Placeholder Deletion Test: ${rowsDeleted} rows removed from sample.`); setStatusMessage(`Placeholder Deletion Test Complete.`); setIsTestingPlaceholderDescRowDeletion(false);
  };
  const handleMostlyEmptyRowsTest = () => {
    addLog("Initiating Mostly Empty Row Deletion Test."); setIsTestingMostlyEmptyRowDeletion(true); setMergedTestDataForTable(null); setAiTestedDataForTable(null); setDetailedDescriptionTestOutput(null); let dataToProcess = deletedPlaceholderDescRowsTestDataForTable || preprocessedTestDataForTable; if (!dataToProcess) { try { dataToProcess = JSON.parse(displayData); dataToProcess = [dataToProcess![0], ...dataToProcess!.slice(1, Math.min(dataToProcess!.length, TEST_DATA_ROW_COUNT + 1))]; } catch { setStatusMessage("Mostly Empty Deletion Test: Invalid JSON or previous test result missing."); setIsTestingMostlyEmptyRowDeletion(false); return; } } if (!dataToProcess || dataToProcess.length < 2) { setStatusMessage("Mostly Empty Deletion Test: Not enough data from previous step."); setIsTestingMostlyEmptyRowDeletion(false); return; }
    const { cleanedData, rowsDeleted } = performMostlyEmptyRowsLogic(dataToProcess, "Test"); setDeletedMostlyEmptyRowsTestDataForTable(cleanedData); addLog(`Mostly Empty Row Deletion Test: ${rowsDeleted} rows removed from sample.`); setStatusMessage(`Mostly Empty Row Deletion Test Complete.`); setIsTestingMostlyEmptyRowDeletion(false);
  };
  const handleMergeDuplicatesTest = () => {
    addLog("Initiating Merge Duplicates Test."); setIsTestingMergingDuplicates(true); setAiTestedDataForTable(null); setDetailedDescriptionTestOutput(null); let dataToProcess = deletedMostlyEmptyRowsTestDataForTable || deletedPlaceholderDescRowsTestDataForTable || preprocessedTestDataForTable; if (!dataToProcess) { try { dataToProcess = JSON.parse(displayData); dataToProcess = [dataToProcess![0], ...dataToProcess!.slice(1, Math.min(dataToProcess!.length, TEST_DATA_ROW_COUNT + 1))]; } catch { setStatusMessage("Merge Duplicates Test: Invalid JSON or previous test result missing."); setIsTestingMergingDuplicates(false); return; } } if (!dataToProcess || dataToProcess.length < 2) { setStatusMessage("Merge Duplicates Test: Not enough data from previous step."); setIsTestingMergingDuplicates(false); return; }
    const { mergedData, rowsAfter, rowsBefore } = performMergeDuplicatesLogic(dataToProcess, "Test"); setMergedTestDataForTable(mergedData); addLog(`Merge Duplicates Test: Started with ${rowsBefore} data rows, resulted in ${rowsAfter} rows.`); setStatusMessage(`Merge Duplicates Test Complete.`); setIsTestingMergingDuplicates(false);
  };
  const handleAiTestOnPreprocessedData = async () => { // URL Finding Test
    if (!genAI) { setStatusMessage('AI Test: Gemini API key missing.'); return; }
    const dataForAiTest = mergedTestDataForTable || deletedMostlyEmptyRowsTestDataForTable || deletedPlaceholderDescRowsTestDataForTable || preprocessedTestDataForTable;
    if (!dataForAiTest || dataForAiTest.length < 2) { setStatusMessage("AI URL Finding Test: Run previous test steps first or ensure data is loaded."); addLog("AI URL Finding Test: No preprocessed data for AI test."); return; }
    addLog(`Initiating AI URL Finding Test on ${dataForAiTest.length -1} data rows from the test sample.`); setIsTestingAiOnPreprocessed(true); setPreRunEstimation(null);
    const modelToUse = 'gemini-2.5-flash-preview-04-17';
    setCurrentOperationStats({ operationType: 'test_url', status: 'running', inputTokens: 0, outputTokens: 0, apiRequests: 0, estimatedCost: 0, modelUsed: modelToUse, progressMessage: `Processing ${dataForAiTest.length -1} rows...` });
    setAiGroundingSources([]); const dataForAiTestString = JSON.stringify(dataForAiTest);
    const testPrompt = `For the provided JSON array of CSV data (first row is headers): <data>${dataForAiTestString}</data> Task: 1. For each data row (skip header): a. Organization Name is in Column A (index 0). b. Using Google Search to find the official website URL. Prioritize known businesses. c. If URL found, put main domain (e.g., "company.com") in Column C. Ensure Column C header is "Website URL". If Column C doesn't exist, add it with this header. d. If no URL or not a business, ensure Column C is an empty string. e. Preserve all other data. 2. Output the *entire modified data* (header + data rows) as a JSON array of arrays. All cell values must be strings.`;
    let response: GenerateContentResponse | undefined; let opInputTokens = 0; let opOutputTokens = 0; let opApiRequests = 0;
    try {
      const promptTokenContents: Content[] = [{role: 'user', parts: [{text: testPrompt}]}]; opInputTokens = await getTokenCountForModel(promptTokenContents, modelToUse);
      setCurrentOperationStats(prev => ({ ...prev, inputTokens: opInputTokens, estimatedCost: calculateOperationCost(opInputTokens, 0, 1, 'flash') }));
      response = await genAI.models.generateContent({ model: modelToUse, contents: promptTokenContents, config: { tools: [{googleSearch: {}}] } });
      opApiRequests = 1; if (!response || typeof response.text !== 'string') { addLog("AI URL Test: API call completed but response or response.text is invalid/missing."); throw new Error("Invalid/empty AI response structure from Gemini API."); }
      addLog(`AI URL Test: Received response. Raw AI response (first 100 chars): ${response.text.substring(0,100)}...`);
      const responseTokenContents: Content[] = [{role: 'model', parts: [{text: response.text}]}]; opOutputTokens = await getTokenCountForModel(responseTokenContents, modelToUse);
      setCurrentOperationStats(prev => ({ ...prev, outputTokens: opOutputTokens, apiRequests: opApiRequests, estimatedCost: calculateOperationCost(opInputTokens, opOutputTokens, opApiRequests, 'flash') }));
      let aiResponseText = response.text.trim(); addLog(`AI URL Test: Processing AI response (Output Tokens: ${opOutputTokens}).`); const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s; let match = aiResponseText.match(fenceRegex);
      if (match && match[2]) { aiResponseText = match[2].trim(); addLog("AI URL Test: Removed markdown fences from AI response."); } else { addLog("AI URL Test: No markdown fences found. Trying to extract JSON array directly."); const firstBracket = aiResponseText.indexOf('['); const lastBracket = aiResponseText.lastIndexOf(']'); if (firstBracket !== -1 && lastBracket > firstBracket) { const potentialJson = aiResponseText.substring(firstBracket, lastBracket + 1); try { JSON.parse(potentialJson); aiResponseText = potentialJson; addLog("AI URL Test: Successfully extracted JSON array from response."); } catch { addLog("AI URL Test: Failed to extract a valid JSON array from response, proceeding with original text."); } } else { addLog("AI URL Test: No JSON array brackets found, proceeding with original text."); } }
      const suggestedAiTestDataUncleaned = JSON.parse(aiResponseText);
      if (Array.isArray(suggestedAiTestDataUncleaned)) { const suggestedAiTestData = cleanAiNotFoundResponses(suggestedAiTestDataUncleaned); setAiTestedDataForTable(suggestedAiTestData); addLog("AI URL Test: Parsed & cleaned AI response.");
        const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
        if (groundingMetadata?.groundingChunks) { const webChunks = groundingMetadata.groundingChunks.filter(c => c.web && c.web.uri); setAiGroundingSources(webChunks); addLog(`AI URL Test: Found ${webChunks.length} valid grounding sources.`); } else {addLog("AI URL Test: No web grounding sources found in AI response.");}
        setCurrentOperationStats(prev => ({ ...prev, status: 'completed', progressMessage: 'AI URL Finding Test complete.' }));
      } else { throw new Error(`AI URL Test: AI response was not a JSON array.`); }
    } catch (e: any) { console.error(`AI URL Test: Error:`, e); setStatusMessage(`AI URL Finding Test: Error: ${e.message}.`); addLog(`AI URL Finding Test: Error encountered: ${e.message}`); setCurrentOperationStats(prev => ({ ...prev, status: 'error', progressMessage: `Error: ${e.message}` }));
    } finally { setTotalInputTokens(p => p + opInputTokens); setTotalOutputTokens(p => p + opOutputTokens); setTotalApiRequestsMade(p => p + opApiRequests); setEstimatedCost(prev => prev + calculateOperationCost(opInputTokens, opOutputTokens, opApiRequests, 'flash'));  recalculateCumulativeSessionCost(); setIsTestingAiOnPreprocessed(false); }
  };

  const generateDetailedDescriptionForOrganization = async (
    orgName: string, orgUrl: string, existingDesc: string, 
    currentOpAccumulators: { input: number; output: number; requests: number; cost: number },
    updateOpStatsCallback: (opTokens: {input: number, output: number, requests: number, cost: number}) => void
  ): Promise<{text: string, opTokens?: {input: number, output: number, requests: number}}> => {
      if (!genAI) throw new Error("Gemini API key not configured.");
      addLog(`Dossier Gen: Starting for "${orgName}"`);
      const modelToUse = 'gemini-2.5-pro-preview-04-17';
      const masterPromptTemplate = `Master Prompt: AI Corporate Intelligence Dossier Generation
This prompt is designed to be given to an advanced, tool-enabled AI model (like Gemini) to generate a comprehensive and structured description for each organization in your CRM, following an initial data preprocessing and enrichment stage.

ROLE & GOAL
You are a world-class strategic business and market research analyst. Your sole objective is to create a comprehensive "Corporate Intelligence Dossier" for a target company. This dossier must be meticulously researched, data-driven, and formatted precisely according to the structure provided below.

This output is not for human consumption alone; it will be the primary input for a sophisticated downstream AI engine that finds non-obvious business opportunities. Therefore, the richness, detail, and structure of your output are critical for that AI's success. Your research must be exhaustive and your synthesis insightful.

CONTEXT: The Analytical Models Your Output Will Power
The downstream AI engine that will parse your dossier thinks in terms of specific analytical models. To be effective, your research must provide the necessary data to power these models:

Latent Capability Matching: The AI looks for hidden or unstated capabilities. It connects a customer's need (e.g., "durable ground coverings") to a non-obvious supplier capability (e.g., a "metal foundry"). Your detailed analysis of a company's technology, materials, and processes is essential for this.

Ecosystem Graph-Building: The AI maps an entire business ecosystem to find supply chain gaps and partnership opportunities. Your analysis of a company's Value Chain Role (e.g., Are they an OEM, a Distributor, or a Systems Integrator?), their partners, customers, and competitors is the raw material for this graph.

Contextual Influence & Compatibility Modeling: The AI assesses who the right person is for an introduction based on their contextual influence, not just their job title. It also models the potential "vibe" or compatibility between companies based on their culture and mission. Your analysis of key personnel and corporate values directly feeds this model.

Your research and output must directly and comprehensively serve these three analytical goals.

INPUT DATA
You will be provided with the following initial data for the target organization, which has already been cleaned and preprocessed:

Organization Name: ${orgName}
Website URL: ${orgUrl || '(No URL provided, please try to find if one exists. If a valid official website is found, use it for your research.)'}
Existing Description (Optional): ${existingDesc || '(No existing description provided.)'}

REQUIRED DOSSIER STRUCTURE & CONTENT (2000-3000 words)
You must use your advanced web search and browsing tools to find, analyze, and synthesize information to populate the following markdown structure. Adhere to this format precisely.

Important: If an "Existing Description" is provided as input, use it as a starting point and source of information for your research, but do not be limited by it. Your final output must fully conform to the detailed structure below, replacing the original description with your new, more comprehensive, and deeply structured analysis.

Corporate Intelligence Dossier: ${orgName}
Section A: Executive Overview & Strategic Posture
High-Level Summary (c. 200 words): A dense, executive-level summary of the company. Who are they, what do they do, and what is their primary position in the market? What is their core value proposition?

Mission, Vision, and Stated Values (c. 150 words): Quote the company's official mission, vision, or core values. Analyze what these statements imply about their corporate culture, strategic priorities, and decision-making framework.

Key Financials & Corporate Structure (c. 150 words): Provide the most recent data on annual revenue, employee count, and any funding rounds/status (public, private, VC-backed). Note their headquarters location and any other major operational centers. Classify their size on a 1-5 tier (1=startup, 5=large enterprise).

Section B: Deep Capability & Operational Analysis
This section is the most critical for the downstream AI's analysis.

Primary Business Model (c. 200 words): Detail exactly how the company makes money. Is it B2B hardware sales with service contracts, tiered SaaS subscriptions, project-based consulting fees, distribution margins, licensing fees, etc.? Describe the typical sales cycle or customer engagement model.

Core Products (c. 400 words): List their main products. For each major product, provide a detailed description of its function, key features, and the problem it solves. Do not just list marketing points; explain what it does.

Core Services (c. 400 words): List their main services. For each service, describe what the service entails, the process of delivery, and the value it provides to customers. This could include professional services, managed services, support, implementation, etc.

Key Underlying Technologies & Processes (c. 300 words): This is a crucial section for uncovering latent opportunities. Go beyond the product names. What specific technologies, patents, proprietary processes, or material specializations power their offerings? (e.g., "utilizes a patented 900MHz mesh networking protocol for their IoT devices," "specializes in CNC machining of Inconel and other exotic alloys," "leverages a proprietary AI/ML algorithm for predictive maintenance," "holds patents for a specific chemical bonding process").

Target Markets & Ideal Customer Profile (ICP) (c. 250 words): What specific industries and sub-verticals do they sell to? Describe their ideal customer in detail. What is the size, technical sophistication, and business need of a company that buys from them?

Section C: Ecosystem, Value Chain, and Network Analysis
Value Chain Roles (Narrative Analysis): Based on your complete analysis, describe the organization's primary roles within its key industry verticals in a clear, narrative paragraph. Explicitly use terms like "OEM," "Distributor," "Component Supplier," "End-User," "Service Provider," and "Systems Integrator."

Example 1 (Traffic Hardware Co.): "Within the Traffic Safety vertical, the company functions primarily as an Original Equipment Manufacturer (OEM) and a Solution Provider, designing and building its own branded hardware. In the broader Smart Cities space, it acts as a Component Supplier to larger systems integrators and a strategic Partner to technology firms."

Example 2 (Industrial Distributor): "The company's core role is as a Distributor in the Industrial Automation market. For its electronics offerings, it also functions as a Component Supplier. In providing logistics and inventory management for its clients, it can be classified as a Service Provider."

Known Suppliers & Strategic Technology/Channel Partners (c. 200 words): List their key suppliers or publicly announced technology/channel partners. (e.g., "They are a certified partner of Microsoft Azure," "They use Salesforce as their core CRM," "They list a partnership with Oracle on their website."). This is vital for mapping the dependency graph.

Known Customers & Case Studies (c. 250 words): List any publicly named customers or summarize key case studies. What were the customers' problems and what results did the organization deliver? This provides concrete evidence of their capabilities.

Known Competitors (c. 200 words): List their main direct and indirect competitors. Briefly describe why each is a competitor.

Section D: Strategic & Forward-Looking Analysis
Strategic Direction & Recent News (c. 300 words): Summarize the company's recent strategic direction based on press releases, news articles, blog posts, and leadership statements from the last 12-18 months. Are they expanding into new markets, launching major products, acquiring companies, or investing heavily in specific R&D?

Key Personnel & Inferred Influence (c. 250 words): Identify 3-5 key leaders (C-suite, VPs, Directors). For each, provide their title and infer their primary dimension of influence based on their role. You must use and justify one of the following five classifications for each person's primary influence:

Spec-Driving Power: The ability to define or influence technical specifications. This is the power of the "trusted user" like an engineer or foreman who decides what features a product needs.

Purchasing Power: The authority to execute a purchase or sign a contract. This is the power of a procurement officer or department head who controls the budget.

Strategic Power: The authority to initiate new, large-scale projects or approve major strategic shifts. This is the power of a C-level executive or visionary who can greenlight a new direction.

Networking Power: An individual known for their extensive connections and ability to facilitate introductions between other people or organizations.

Champion Power: The ability to build internal support for an idea or project, even without formal authority. This is the power of a respected internal influencer who can get other people's attention.

Example: "Jane Doe, Chief Technology Officer - Primary Influence: Strategic Power. As CTO, she is responsible for the company's long-term technology vision and makes decisions on large-scale platform investments, which directly aligns with initiating new, strategic projects."

INSTRUCTIONS & CONSTRAINTS
Be Exhaustive: Use your tools to go deep. Your research should include the company website, news articles, press releases, technical white papers, case studies, partner pages, and professional networking site data.

Cite Sources: For specific, non-obvious data points (like financial numbers, partnerships, or technical specifications), use markdown footnotes [^1]. List the full URLs for the footnotes at the very end of the document.

Word Count: The final dossier must be between 2000 and 3000 words.

Tone: Maintain a professional, objective, data-driven, and analytical tone.

Final Output: Your final response must be a single, clean markdown document. Do not include conversational filler. Begin the response immediately with the dossier's title.`;

      let retries = 0;
      const MAX_PRO_RETRIES = 1; // Fewer retries for longer generation
      let opTokensForCall = { input: 0, output: 0, requests: 0 };

      const promptContent: Content[] = [{ role: 'user', parts: [{ text: masterPromptTemplate }] }];
      opTokensForCall.input = await getTokenCountForModel(promptContent, modelToUse);
      
      currentOpAccumulators.input += opTokensForCall.input;
      let costForThisCall = calculateOperationCost(opTokensForCall.input, 0, 1, 'pro');
      updateOpStatsCallback({input: opTokensForCall.input, output: 0, requests: 0, cost: costForThisCall});


      while (retries <= MAX_PRO_RETRIES) {
          try {
              if (retries > 0) {
                  const delay = 3000 * Math.pow(2, retries - 1); // Longer initial backoff for pro model
                  addLog(`Dossier Gen for "${orgName}": Retrying (attempt ${retries + 1}) after ${delay}ms...`);
                  await new Promise(resolve => setTimeout(resolve, delay));
              }
              addLog(`Dossier Gen for "${orgName}": Sending request to ${modelToUse} (Input Tokens: ${opTokensForCall.input}). Attempt ${retries + 1}.`);
              const response = await genAI.models.generateContent({
                  model: modelToUse,
                  contents: promptContent,
                  config: { tools: [{ googleSearch: {} }] } 
              });
              opTokensForCall.requests = 1;

              if (!response || typeof response.text !== 'string') {
                  addLog(`Dossier Gen for "${orgName}", attempt ${retries + 1}: Invalid or empty response structure from Gemini API.`);
                  throw new Error("Invalid or empty response structure from Gemini Pro API.");
              }
              
              const responseContent: Content[] = [{ role: 'model', parts: [{ text: response.text }] }];
              opTokensForCall.output = await getTokenCountForModel(responseContent, modelToUse);
              currentOpAccumulators.output += opTokensForCall.output;
              currentOpAccumulators.requests += opTokensForCall.requests;
              
              costForThisCall = calculateOperationCost(opTokensForCall.input, opTokensForCall.output, opTokensForCall.requests, 'pro');
              updateOpStatsCallback({input:0, output: opTokensForCall.output, requests: opTokensForCall.requests, cost: costForThisCall - calculateOperationCost(opTokensForCall.input, 0, 1, 'pro') }); // Update with output cost delta

              addLog(`Dossier Gen for "${orgName}": Received response (Output Tokens: ${opTokensForCall.output}).`);
              return { text: response.text, opTokens: opTokensForCall };

          } catch (e: any) {
              addLog(`Dossier Gen for "${orgName}", attempt ${retries + 1} Error: ${e.message}`);
              retries++;
              if (retries > MAX_PRO_RETRIES) {
                  addLog(`Dossier Gen for "${orgName}": Failed after ${MAX_PRO_RETRIES + 1} attempts. Skipping dossier generation for this row.`);
                  throw new Error(`Failed to generate dossier for ${orgName} after retries.`);
              }
          }
      }
      throw new Error(`Should not reach here - dossier generation failed for ${orgName}`);
  };

  const handleTestDescriptionGeneration = async () => {
    if (!genAI) { setStatusMessage('Dossier Test: Gemini API key missing.'); return; }
    let dataForTest: string[][];
    try { dataForTest = JSON.parse(displayData); } catch { setStatusMessage("Dossier Test: Invalid JSON in display. Cannot proceed."); addLog("Dossier Test Error: Parsing main display data."); return; }
    if (dataForTest.length < 2) { setStatusMessage("Dossier Test: Not enough data loaded."); addLog("Dossier Test: No data for test."); return; }

    const firstDataRow = dataForTest[1];
    const orgName = String(firstDataRow[0] ?? '').trim();
    const orgUrl = String(firstDataRow[2] ?? '').trim();
    const existingDesc = String(firstDataRow[63] ?? '').trim();
    if (!orgName) { setStatusMessage("Dossier Test: First data row has no organization name."); addLog("Dossier Test: No org name in first row."); return; }
    
    addLog(`Initiating Detailed Dossier Generation Test for: "${orgName}"`);
    setIsTestingDescriptionGeneration(true); setDetailedDescriptionTestOutput(null); setPreRunEstimation(null);
    const modelToUse = 'gemini-2.5-pro-preview-04-17';
    setCurrentOperationStats({ operationType: 'test_dossier', status: 'running', inputTokens: 0, outputTokens: 0, apiRequests: 0, estimatedCost: 0, modelUsed: modelToUse, progressMessage: `Generating dossier for ${orgName}...`});
    
    let opAccumulator = { input: 0, output: 0, requests: 0, cost: 0 };

    try {
      const {text: dossierText, opTokens} = await generateDetailedDescriptionForOrganization(
        orgName, orgUrl, existingDesc, opAccumulator, 
        (stats) => { // Callback to update stats incrementally within this test
            setCurrentOperationStats(prev => ({
                ...prev,
                inputTokens: prev.inputTokens + stats.input,
                outputTokens: prev.outputTokens + stats.output,
                apiRequests: prev.apiRequests + stats.requests,
                estimatedCost: prev.estimatedCost + stats.cost
            }));
        }
      );
      setDetailedDescriptionTestOutput(dossierText);
      addLog(`Dossier Test: Successfully generated dossier for "${orgName}".`);
      setCurrentOperationStats(prev => ({ ...prev, status: 'completed', progressMessage: 'Test complete.' }));
    } catch (e: any) {
      addLog(`Dossier Test Error for "${orgName}": ${e.message}`);
      setStatusMessage(`Dossier Test Error: ${e.message}`);
      setDetailedDescriptionTestOutput(`Error generating dossier: ${e.message}`);
      setCurrentOperationStats(prev => ({ ...prev, status: 'error', progressMessage: `Error: ${e.message}` }));
    } finally {
      setTotalInputTokens(prev => prev + currentOperationStats.inputTokens);
      setTotalOutputTokens(prev => prev + currentOperationStats.outputTokens);
      setTotalApiRequestsMade(prev => prev + currentOperationStats.apiRequests);
      setEstimatedCost(prev => prev + currentOperationStats.estimatedCost); // Add the cost of this op
      recalculateCumulativeSessionCost(); // To update grounding if applicable
      setIsTestingDescriptionGeneration(false);
    }
  };

  // --- Full Processing Handlers ---
  const handleFullContactsPreprocessing = () => {
    addLog("Initiating Full Data Pre-processing (URL pre-fill from contacts).");
    setIsProcessingContactsFull(true);
    setStatusMessage('Pre-filling URLs in full dataset from contacts...');

    let currentData: string[][];
    try {
      currentData = JSON.parse(displayData);
      if (!Array.isArray(currentData) || currentData.length === 0) {
        throw new Error("Main data is empty or not an array.");
      }
    } catch (e) {
      const errorMsg = `Full Pre-processing: Invalid JSON in main display. Cannot proceed. ${e instanceof Error ? e.message : String(e)}`;
      setStatusMessage(errorMsg);
      addLog(errorMsg);
      setIsProcessingContactsFull(false);
      return;
    }

    if (!rawContactsSheetData || rawContactsSheetData.length < 2) {
      setStatusMessage("Full Pre-processing: No corrected contacts data available to pre-fill URLs from. (Requires Excel with 2nd sheet).");
      addLog("Full Pre-processing: No corrected contacts data available. Skipping pre-fill.");
      setIsProcessingContactsFull(false);
      return;
    }

    try {
      const { updatedOrgsData, prefilledCount } = prefillUrlsFromContacts(currentData, rawContactsSheetData);
      updateDisplayData(updatedOrgsData, 'full_contact_prefill', `Full Data Pre-processing Complete: ${prefilledCount} URLs pre-filled.`);
    } catch (e) {
      const errorMsg = `Error during full contact pre-processing: ${e instanceof Error ? e.message : String(e)}`;
      setStatusMessage(errorMsg);
      addLog(errorMsg);
    } finally {
      setIsProcessingContactsFull(false);
    }
  };

  const handleFullPlaceholderDescRowDeletion = () => {
    addLog("Initiating Full Placeholder Description Row Deletion.");
    setIsPerformingFullPlaceholderDescRowDeletion(true);
    setStatusMessage('Deleting placeholder description rows from full dataset...');

    let currentData: string[][];
    try {
      currentData = JSON.parse(displayData);
      if (!Array.isArray(currentData) || currentData.length === 0) {
        throw new Error("Main data is empty or not an array.");
      }
    } catch (e) {
      const errorMsg = `Full Placeholder Deletion: Invalid JSON in main display. ${e instanceof Error ? e.message : String(e)}`;
      setStatusMessage(errorMsg);
      addLog(errorMsg);
      setIsPerformingFullPlaceholderDescRowDeletion(false);
      return;
    }
    
    try {
        const { cleanedData, rowsDeleted } = performPlaceholderDescRowDeletionLogic(currentData, "Full");
        updateDisplayData(cleanedData, 'full_placeholder_delete', `Full Placeholder Desc Row Deletion Complete. ${rowsDeleted} rows removed.`);
    } catch (e) {
        const errorMsg = `Error during full placeholder deletion: ${e instanceof Error ? e.message : String(e)}`;
        setStatusMessage(errorMsg);
        addLog(errorMsg);
    } finally {
        setIsPerformingFullPlaceholderDescRowDeletion(false);
    }
  };

  const handleFullMostlyEmptyRows = () => {
    addLog("Initiating Full Mostly Empty Row Deletion.");
    setIsPerformingFullMostlyEmptyRowDeletion(true);
    setStatusMessage('Deleting mostly empty rows from full dataset...');
    
    let currentData: string[][];
    try {
      currentData = JSON.parse(displayData);
      if (!Array.isArray(currentData) || currentData.length === 0) {
        throw new Error("Main data is empty or not an array.");
      }
    } catch (e) {
      const errorMsg = `Full Mostly Empty Row Deletion: Invalid JSON. ${e instanceof Error ? e.message : String(e)}`;
      setStatusMessage(errorMsg);
      addLog(errorMsg);
      setIsPerformingFullMostlyEmptyRowDeletion(false);
      return;
    }

    try {
        const { cleanedData, rowsDeleted } = performMostlyEmptyRowsLogic(currentData, "Full");
        updateDisplayData(cleanedData, 'full_mostly_empty_delete', `Full Mostly Empty Row Deletion Complete. ${rowsDeleted} rows removed.`);
    } catch (e) {
        const errorMsg = `Error during full mostly empty row deletion: ${e instanceof Error ? e.message : String(e)}`;
        setStatusMessage(errorMsg);
        addLog(errorMsg);
    } finally {
        setIsPerformingFullMostlyEmptyRowDeletion(false);
    }
  };
  
  const handleMergeDuplicateOrganizations = () => {
    addLog("Initiating Full Merge Duplicate Organizations.");
    setIsMergingDuplicatesFull(true);
    setStatusMessage('Merging duplicate organizations in full dataset...');

    let currentData: string[][];
    try {
      currentData = JSON.parse(displayData);
       if (!Array.isArray(currentData) || currentData.length === 0) {
        throw new Error("Main data is empty or not an array.");
      }
    } catch (e) {
      const errorMsg = `Full Merge Duplicates: Invalid JSON. ${e instanceof Error ? e.message : String(e)}`;
      setStatusMessage(errorMsg);
      addLog(errorMsg);
      setIsMergingDuplicatesFull(false);
      return;
    }

    try {
        const { mergedData, rowsBefore, rowsAfter } = performMergeDuplicatesLogic(currentData, "Full");
        updateDisplayData(mergedData, 'full_merge_duplicates', `Full Merge Duplicates Complete. Rows before: ${rowsBefore}, Rows after: ${rowsAfter}.`);
    } catch (e) {
        const errorMsg = `Error during full merge duplicates: ${e instanceof Error ? e.message : String(e)}`;
        setStatusMessage(errorMsg);
        addLog(errorMsg);
    } finally {
        setIsMergingDuplicatesFull(false);
    }
  };


  const handleGenerateFullDescriptions = async () => {
    if (!genAI) { setStatusMessage('Full Dossier Gen: Gemini API key missing.'); addLog("Full Dossier Gen Error: API key missing."); return; }
    addLog("Full Dossier Generation (Step 3 - AI): Initiated.");
    
    let dataToProcess: string[][];
    try { dataToProcess = JSON.parse(displayData); if (!Array.isArray(dataToProcess) || dataToProcess.length < 2) throw new Error("Invalid/insufficient data."); } 
    catch (e) { setStatusMessage(`Full Dossier Gen: Error parsing display data: ${e instanceof Error ? e.message : String(e)}`); addLog(`Full Dossier Gen Error: ${e instanceof Error ? e.message : String(e)}`); return; }
    
    setIsGeneratingFullDescriptions(true); setPreRunEstimation(null);
    const modelToUse = 'gemini-2.5-pro-preview-04-17';
    setCurrentOperationStats({ operationType: 'full_dossier', status: 'running', inputTokens: 0, outputTokens: 0, apiRequests: 0, estimatedCost: 0, modelUsed: modelToUse, progressMessage: 'Starting dossier generation...' });

    const headerRow = [...dataToProcess[0]];
    const dataRows = dataToProcess.slice(1).map(row => [...row]); // Make a mutable copy
    const DESCRIPTION_COL_INDEX = 63;
    
    let currentOpAccumulator = { input: 0, output: 0, requests: 0, cost: 0 };

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const orgName = String(row[0] ?? '').trim();
      const orgUrl = String(row[2] ?? '').trim();
      const existingDesc = String(row[DESCRIPTION_COL_INDEX] ?? '').trim();
      
      const progressMsg = `Generating dossier for "${orgName}" (${i + 1} of ${dataRows.length})...`;
      setStatusMessage(progressMsg);
      setCurrentOperationStats(prev => ({ ...prev, progressMessage: progressMsg }));
      addLog(progressMsg);

      if (!orgName) { addLog(`Skipping row ${i + 1} due to missing organization name.`); continue; }

      try {
        const { text: newDescription, opTokens } = await generateDetailedDescriptionForOrganization(
          orgName, orgUrl, existingDesc, currentOpAccumulator,
          (stats) => { // This callback updates stats PER AI CALL within the loop
            setCurrentOperationStats(prev => ({
                ...prev,
                inputTokens: prev.inputTokens + stats.input,
                outputTokens: prev.outputTokens + stats.output,
                apiRequests: prev.apiRequests + stats.requests,
                estimatedCost: prev.estimatedCost + stats.cost
            }));
          }
        );
        
        while(dataRows[i].length <= DESCRIPTION_COL_INDEX) dataRows[i].push('');
        dataRows[i][DESCRIPTION_COL_INDEX] = newDescription;
        addLog(`Full Dossier Gen: Updated description for "${orgName}".`);

        // Update main display incrementally
        const currentFullData = [headerRow, ...dataRows];
        setCsvData(currentFullData); // Update underlying source for next iteration if needed
        setDisplayData(JSON.stringify(currentFullData, null, 2)); // Update UI
      
      } catch (e: any) {
        addLog(`Full Dossier Gen: Error for "${orgName}": ${e.message}. Description not updated for this row.`);
        // Optionally mark the row or leave existing description
      }
      // Optional: Add a small delay between API calls if rate limiting is an issue
      // await new Promise(resolve => setTimeout(resolve, 500)); 
    }

    setCurrentOperationStats(prev => ({ ...prev, status: 'completed', progressMessage: `All ${dataRows.length} dossiers processed.` }));
    setTotalInputTokens(p => p + currentOperationStats.inputTokens);
    setTotalOutputTokens(p => p + currentOperationStats.outputTokens);
    setTotalApiRequestsMade(p => p + currentOperationStats.apiRequests);
    setEstimatedCost(prev => prev + currentOperationStats.estimatedCost); // Add this operation's total cost
    recalculateCumulativeSessionCost();
    updateDisplayData([headerRow, ...dataRows], 'ai_dossier_gen', `Full Dossier Generation Complete.`);
    setIsGeneratingFullDescriptions(false);
  };
  
  const handleFindUrlsWithAi = async () => { 
    if (!genAI) { setStatusMessage('Full AI: Gemini API key missing.'); addLog("Full AI Processing Error: Gemini API key missing."); return; }
    addLog("Full AI Processing (Step 2 - AI Find Missing URLs): Initiated."); setSkippedBatchNumbers([]); setPreRunEstimation(null);
    let initialDataForProcessing: string[][]; try { initialDataForProcessing = JSON.parse(displayData); if (!Array.isArray(initialDataForProcessing) || initialDataForProcessing.length < 2) throw new Error("Invalid/insufficient data in main display.");} catch (e) { setStatusMessage(`Full AI: Error parsing display data: ${e instanceof Error ? e.message : String(e)}`); addLog(`Full AI Error: ${e instanceof Error ? e.message : String(e)}`); return; }
    
    const modelToUse = 'gemini-2.5-flash-preview-04-17';
    setIsLoading(true); 
    setCurrentOperationStats({ operationType: 'full_url', status: 'running', inputTokens: 0, outputTokens: 0, apiRequests: 0, estimatedCost: 0, modelUsed: modelToUse, progressMessage: 'Starting URL finding...' });
    setAiGroundingSources([]); 
    let currentRunOpInputTokens = 0; let currentRunOpOutputTokens = 0; let currentRunOpApiRequests = 0;
    const runSkippedBatchNumbersLocal: number[] = [];
    const headerRow = initialDataForProcessing[0]; const dataRows = initialDataForProcessing.slice(1);
    const BATCH_SIZE = 20; const MAX_RETRIES = 3; const INITIAL_BACKOFF_MS = 2000; const totalBatches = Math.ceil(dataRows.length / BATCH_SIZE);
    let allProcessedDataRows: string[][] = []; let accumulatedGroundingSourcesFromBatches: any[] = [];

    for (let i = 0; i < totalBatches; i++) {
      const batchStart = i * BATCH_SIZE; const batchEnd = batchStart + BATCH_SIZE; const currentChunkOfOriginalDataRows = dataRows.slice(batchStart, batchEnd);
      const batchDisplayNum = i + 1;
      const progressMsg = `Processing Batch ${batchDisplayNum} of ${totalBatches} (Data Rows ${batchStart + 1}-${Math.min(batchEnd, dataRows.length)} of ${dataRows.length})...`;
      
      setCurrentOperationStats(prev => ({ ...prev, progressMessage: progressMsg })); addLog(progressMsg);
      
      const itemsRequiringAiLookup: { originalIndexInChunk: number, rowData: string[] }[] = [];
      currentChunkOfOriginalDataRows.forEach((row, index) => { if (!isPlausibleUrl(String(row[2] ?? ''))) { itemsRequiringAiLookup.push({ originalIndexInChunk: index, rowData: row.map(cell => String(cell ?? '')) }); } });
      
      if (itemsRequiringAiLookup.length === 0) { 
        addLog(`Full AI: Batch ${batchDisplayNum} - All rows have URLs. Skipping AI call.`); 
        allProcessedDataRows.push(...currentChunkOfOriginalDataRows.map(r => r.map(cell => String(cell ?? '')))); 
      } else {
        addLog(`Full AI: Batch ${batchDisplayNum} - ${itemsRequiringAiLookup.length}/${currentChunkOfOriginalDataRows.length} rows require URL lookup.`);
        const dataRowsForAISubmissionOnly = itemsRequiringAiLookup.map(item => item.rowData);
        const dataToSendToAiForBatch = [headerRow, ...dataRowsForAISubmissionOnly];
        const dataToSendToAiString = JSON.stringify(dataToSendToAiForBatch);
        const specializedPromptForBatch = `For this JSON array of CSV data (header + data rows): <data>${dataToSendToAiString}</data> Task: For each data row (skip header): a. Organization Name is Column A (index 0). b. Using Google Search to find the official website URL. Prioritize known businesses. c. If URL found, put main domain (e.g., "company.com") in Column C. Ensure Column C header is "Website URL". If Column C doesn't exist, add it with this header. d. If no URL or not a business, ensure Column C is an empty string. e. Preserve all other data. Output *entire modified data* (header + data rows) as JSON array of arrays. All cell values must be strings.`;
        
        let response: GenerateContentResponse | undefined; let retries = 0; let batchSuccess = false; 
        let batchInputTokens = 0; let batchOutputTokens = 0; let batchApiRequestMadeThisAttempt = false;

        const promptTokenContents: Content[] = [{role: 'user', parts: [{text: specializedPromptForBatch}]}];
        batchInputTokens = await getTokenCountForModel(promptTokenContents, modelToUse); 
        currentRunOpInputTokens += batchInputTokens;
        setCurrentOperationStats(prev => ({ ...prev, inputTokens: currentRunOpInputTokens, estimatedCost: calculateOperationCost(currentRunOpInputTokens, currentRunOpOutputTokens, currentRunOpApiRequests + 1, 'flash') })); // Estimate with 1 request
        
        while(retries <= MAX_RETRIES && !batchSuccess) {
          try {
            if (retries > 0) { 
                const delay = INITIAL_BACKOFF_MS * Math.pow(2, retries - 1) + Math.random() * 1000; 
                addLog(`Full AI: Retrying batch ${batchDisplayNum} (attempt ${retries + 1}) after ${delay.toFixed(0)}ms due to previous error...`); 
                await new Promise(resolve => setTimeout(resolve, delay)); 
            } else { 
                addLog(`Full AI: Sending Batch ${batchDisplayNum} to AI (Input Tokens: ${batchInputTokens}). Attempt ${retries + 1}.`); 
            }
            response = await genAI.models.generateContent({ model: modelToUse, contents: promptTokenContents, config: { tools: [{googleSearch: {}}] } });
            if (!batchApiRequestMadeThisAttempt && retries === 0) { // Count API request only once per successful batch or final failed attempt
                currentRunOpApiRequests++; 
                batchApiRequestMadeThisAttempt = true;
            }
            
            if (!response || typeof response.text !== 'string') { 
                const errorMsg = `Invalid or empty response structure from Gemini API.`;
                addLog(`Full AI: Error on batch ${batchDisplayNum}, attempt ${retries + 1}: ${errorMsg}`);
                throw new Error(errorMsg); 
            }
            addLog(`Full AI: Received response from Gemini API for batch ${batchDisplayNum}.`);
            const responseTokenContents : Content[] = [{role: 'model', parts: [{text: response.text}]}]; 
            batchOutputTokens = await getTokenCountForModel(responseTokenContents, modelToUse); 
            currentRunOpOutputTokens += batchOutputTokens;
            setCurrentOperationStats(prev => ({ ...prev, outputTokens: currentRunOpOutputTokens, apiRequests: currentRunOpApiRequests, estimatedCost: calculateOperationCost(currentRunOpInputTokens, currentRunOpOutputTokens, currentRunOpApiRequests, 'flash') }));
            addLog(`Full AI: Raw AI response for batch ${batchDisplayNum} (Output Tokens: ${batchOutputTokens}): ${response.text.substring(0, 100)}...`);
            
            let aiResponseText = response.text.trim(); 
            const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s; 
            let match = aiResponseText.match(fenceRegex);
            if (match && match[2]) { aiResponseText = match[2].trim(); addLog(`Full AI: Removed markdown fences from AI response for batch ${batchDisplayNum}.`); } 
            else { addLog(`Full AI: No markdown fences detected for batch ${batchDisplayNum}. Trying to extract JSON array.`); 
                const firstBracket = aiResponseText.indexOf('['); const lastBracket = aiResponseText.lastIndexOf(']'); 
                if (firstBracket !== -1 && lastBracket > firstBracket) { const potentialJson = aiResponseText.substring(firstBracket, lastBracket + 1); 
                    try { JSON.parse(potentialJson); aiResponseText = potentialJson; addLog(`Full AI: Successfully extracted JSON array from AI response for batch ${batchDisplayNum}.`);} catch {} 
                } 
            }
            addLog(`Full AI: Attempting to parse AI response for batch ${batchDisplayNum} as JSON.`); 
            const suggestedBatchDataFromAIUncleaned = JSON.parse(aiResponseText);
            addLog(`Full AI: Successfully parsed AI response for batch ${batchDisplayNum}.`);
            const suggestedBatchDataFromAI = cleanAiNotFoundResponses(suggestedBatchDataFromAIUncleaned);
            const finalProcessedChunkForThisBatch = currentChunkOfOriginalDataRows.map(r => [...r.map(cell => String(cell ?? ''))]); 
            const aiProcessedRowsOnly = headerRow.length > 0 ? suggestedBatchDataFromAI.slice(1) : suggestedBatchDataFromAI;
            if (!Array.isArray(aiProcessedRowsOnly) || aiProcessedRowsOnly.length !== itemsRequiringAiLookup.length) { throw new Error(`AI response row count mismatch for batch ${batchDisplayNum}. Expected ${itemsRequiringAiLookup.length}, got ${aiProcessedRowsOnly.length}`); }
            aiProcessedRowsOnly.forEach((aiRow, idx) => { if (!Array.isArray(aiRow)) { addLog(`Full AI: AI returned non-array row at index ${idx} for batch ${batchDisplayNum}. Skipping this row update.`); return; } const originalRowInfo = itemsRequiringAiLookup[idx]; const originalChunkIdx = originalRowInfo.originalIndexInChunk; const aiFoundUrl = String(aiRow[2] ?? ""); while (finalProcessedChunkForThisBatch[originalChunkIdx].length < 3) finalProcessedChunkForThisBatch[originalChunkIdx].push(''); finalProcessedChunkForThisBatch[originalChunkIdx][2] = aiFoundUrl; });
            allProcessedDataRows.push(...finalProcessedChunkForThisBatch);
            const groundingMetadata = response.candidates?.[0]?.groundingMetadata; if (groundingMetadata?.groundingChunks) { const webChunks = groundingMetadata.groundingChunks.filter(c => c.web && c.web.uri); accumulatedGroundingSourcesFromBatches.push(...webChunks); addLog(`Full AI: Found ${webChunks.length} web grounding sources in AI response for batch ${batchDisplayNum}.`); } else { addLog(`Full AI: No web grounding sources found in AI response for batch ${batchDisplayNum}.`);}
            batchSuccess = true;
          } catch (e: any) {
            const errorDetail = e.message + (response && typeof response.text === 'string' ? ` Raw AI Response Snippet: ${response.text.substring(0, 200)}...` : '');
            addLog(`Full AI Processing (Step 2): Error on batch ${batchDisplayNum}, attempt ${retries + 1}: ${errorDetail}`); retries++;
            if (retries > MAX_RETRIES) { 
                addLog(`Full AI Processing (Step 2): Batch ${batchDisplayNum} failed after ${MAX_RETRIES + 1} attempts. Skipping this batch and preserving original data.`); 
                allProcessedDataRows.push(...currentChunkOfOriginalDataRows.map(r => r.map(cell => String(cell ?? '')))); 
                runSkippedBatchNumbersLocal.push(batchDisplayNum); 
                if (!batchApiRequestMadeThisAttempt && retries === MAX_RETRIES +1) { // Count API request if all retries failed
                    currentRunOpApiRequests++;
                }
                break; 
            }
          }
        }
      }
      setAiGroundingSources([...accumulatedGroundingSourcesFromBatches]);
      // Update display incrementally after each batch
      updateDisplayData([headerRow, ...allProcessedDataRows], 'batch_incremental', `Full AI URL Processing: Batch ${batchDisplayNum} of ${totalBatches} processed. Display updated.`); 
    } 
    setSkippedBatchNumbers(runSkippedBatchNumbersLocal);
    setCurrentOperationStats(prev => ({ ...prev, status: runSkippedBatchNumbersLocal.length > 0 ? 'error' : 'completed', progressMessage: `All URL Batches Processed. ${totalBatches-runSkippedBatchNumbersLocal.length}/${totalBatches} successful. Skipped: ${runSkippedBatchNumbersLocal.join(', ') || 'None'}`}));
    
    setTotalInputTokens(p => p + currentRunOpInputTokens); 
    setTotalOutputTokens(p => p + currentRunOpOutputTokens); 
    setTotalApiRequestsMade(p => p + currentRunOpApiRequests);
    setEstimatedCost(prev => prev + calculateOperationCost(currentRunOpInputTokens, currentRunOpOutputTokens, currentRunOpApiRequests, 'flash'));
    recalculateCumulativeSessionCost();

    let finalMessage = `Full AI URL Finding Complete.`; 
    if (runSkippedBatchNumbersLocal.length > 0) finalMessage += ` ${runSkippedBatchNumbersLocal.length} batch(es) skipped due to errors: ${runSkippedBatchNumbersLocal.join(', ')}.`;
    updateDisplayData([headerRow, ...allProcessedDataRows], 'ai_url_find', finalMessage); 
    setIsLoading(false);
  };

  const handleEstimateFullAiRunCost = async () => {
    if (!genAI) { setStatusMessage('Cost Estimation: Gemini API key missing.'); addLog("Cost Estimation Error: Gemini API key missing."); return; }
    addLog("Cost Estimation: Initiating for Full AI URL Finding Run.");
    setIsEstimatingCost(true);
    setPreRunEstimation(null);
    setCurrentOperationStats({ operationType: null, status: 'estimating_input', inputTokens: 0, outputTokens: 0, apiRequests: 0, estimatedCost: 0, modelUsed: 'gemini-2.5-flash-preview-04-17', progressMessage: 'Estimating URL finding costs...' });

    let dataForEstimation: string[][];
    try {
      dataForEstimation = JSON.parse(displayData);
      if (!Array.isArray(dataForEstimation) || dataForEstimation.length < 2) {
        setStatusMessage("Cost Estimation: Not enough data loaded in main display.");
        addLog("Cost Estimation: No data or insufficient data for estimation.");
        setIsEstimatingCost(false);
        setCurrentOperationStats(initialCurrentOperationStats);
        return;
      }
    } catch (e) {
      const errorMsg = `Cost Estimation: Invalid JSON in main display. ${e instanceof Error ? e.message : String(e)}`;
      setStatusMessage(errorMsg);
      addLog(errorMsg);
      setIsEstimatingCost(false);
      setCurrentOperationStats(initialCurrentOperationStats);
      return;
    }

    const modelToUse = 'gemini-2.5-flash-preview-04-17';
    let totalEstimatedInputTokens = 0;
    let totalEstimatedApiRequests = 0;

    const headerRow = dataForEstimation[0];
    const dataRows = dataForEstimation.slice(1);
    const BATCH_SIZE = 20; // Must match the batch size in handleFindUrlsWithAi
    const totalBatches = Math.ceil(dataRows.length / BATCH_SIZE);

    addLog(`Cost Estimation: Processing ${dataRows.length} data rows in ${totalBatches} potential batches.`);

    for (let i = 0; i < totalBatches; i++) {
      const batchStart = i * BATCH_SIZE;
      const batchEnd = batchStart + BATCH_SIZE;
      const currentChunk = dataRows.slice(batchStart, batchEnd);
      const batchDisplayNum = i + 1;

      const itemsRequiringAiLookup = currentChunk.filter(row => !isPlausibleUrl(String(row[2] ?? '')));

      if (itemsRequiringAiLookup.length > 0) {
        totalEstimatedApiRequests++; // One API request per batch that needs AI
        const dataForAISubmission = [headerRow, ...itemsRequiringAiLookup];
        const dataToSendString = JSON.stringify(dataForAISubmission);
        const prompt = `For this JSON array of CSV data (header + data rows): <data>${dataToSendString}</data> Task: For each data row (skip header): a. Organization Name is Column A (index 0). b. Using Google Search to find the official website URL. Prioritize known businesses. c. If URL found, put main domain (e.g., "company.com") in Column C. Ensure Column C header is "Website URL". If Column C doesn't exist, add it with this header. d. If no URL or not a business, ensure Column C is an empty string. e. Preserve all other data. Output *entire modified data* (header + data rows) as JSON array of arrays. All cell values must be strings.`;
        
        const promptTokenContents: Content[] = [{role: 'user', parts: [{text: prompt}]}];
        try {
            const batchTokens = await getTokenCountForModel(promptTokenContents, modelToUse);
            totalEstimatedInputTokens += batchTokens;
            addLog(`Cost Estimation: Batch ${batchDisplayNum} - ${itemsRequiringAiLookup.length} items, Est. Input Tokens: ${batchTokens}`);
        } catch (e) {
            addLog(`Cost Estimation: Error counting tokens for batch ${batchDisplayNum}: ${e instanceof Error ? e.message : String(e)}`);
            // Potentially stop estimation or mark as partial
        }
      } else {
        addLog(`Cost Estimation: Batch ${batchDisplayNum} - All ${currentChunk.length} rows have plausible URLs. No AI call estimated.`);
      }
    }

    // Calculate estimated cost (input tokens + grounding for API requests)
    // Output tokens are not easily predictable for cost estimation here, so focus on input + grounding
    const inputCost = (totalEstimatedInputTokens / 1000000) * FLASH_PRICE_INPUT_PER_MILLION_TOKENS;
    let groundingCost = 0;
    // This estimates cost IF these requests were made on top of current session's free tier usage
    const potentialTotalRequests = totalApiRequestsMade + totalEstimatedApiRequests;
    if (potentialTotalRequests > FLASH_FREE_GROUNDING_REQUESTS_PER_DAY) {
        const billableRequests = Math.max(0, potentialTotalRequests - FLASH_FREE_GROUNDING_REQUESTS_PER_DAY) - Math.max(0, totalApiRequestsMade - FLASH_FREE_GROUNDING_REQUESTS_PER_DAY);
        if (billableRequests > 0) {
           groundingCost = (billableRequests / 1000) * FLASH_PRICE_GROUNDING_PER_THOUSAND_REQUESTS_AFTER_FREE_TIER;
        }
    }
    
    const estimatedTotalCost = inputCost + groundingCost;

    setPreRunEstimation({
      inputTokens: totalEstimatedInputTokens,
      apiRequests: totalEstimatedApiRequests,
      estimatedInputCost: estimatedTotalCost,
    });

    addLog(`Cost Estimation Complete: Total Est. Input Tokens: ${totalEstimatedInputTokens}, Total Est. API Requests: ${totalEstimatedApiRequests}, Est. Input & Grounding Cost: $${estimatedTotalCost.toFixed(4)}`);
    setStatusMessage('Full AI URL Finding cost estimation complete. See details below.');
    setCurrentOperationStats(prev => ({...prev, status: 'completed', progressMessage: 'Estimation complete.'}));
    setIsEstimatingCost(false);
  };


  const handleDownloadCsv = useCallback(() => { addLog("Download initiated."); if (!displayData.trim()) { setStatusMessage('No data to download.'); addLog('No data for download.'); return; } let dataToDownload; try { dataToDownload = JSON.parse(displayData); if (!Array.isArray(dataToDownload) || (dataToDownload.length > 0 && !Array.isArray(dataToDownload[0]))) throw new Error("Data not valid array of arrays."); } catch(e) { setStatusMessage(`Error parsing data for download: ${e instanceof Error ? e.message : String(e)}`); addLog(`Download Error: ${e instanceof Error ? e.message : String(e)}`); return; } setIsLoading(true); setStatusMessage('Preparing CSV...'); try { const csvString = stringifyCSV(dataToDownload); const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' }); const link = document.createElement('a'); const url = URL.createObjectURL(blob); link.setAttribute('href', url); link.setAttribute('download', fileName); link.style.visibility = 'hidden'; document.body.appendChild(link); link.click(); document.body.removeChild(link); setStatusMessage(`CSV download started as ${fileName}.`); addLog(`CSV download started as ${fileName}.`); } catch (err) { console.error('Error downloading:', err); setStatusMessage(`Error preparing CSV: ${err instanceof Error ? err.message : String(err)}`); addLog(`Error preparing CSV for download: ${err instanceof Error ? err.message : String(err)}`); } finally { setIsLoading(false); } }, [displayData, fileName, addLog]);
  const handleDownloadCorrectedContactsCsv = useCallback(() => { addLog("Corrected Contacts CSV Download initiated."); if (!displayableCorrectedContactsData || displayableCorrectedContactsData.length === 0) { setStatusMessage('No corrected contacts data to download.'); addLog('No corrected contacts data for download.'); return; } setIsLoading(true); setStatusMessage('Preparing Corrected Contacts CSV...'); try { const csvString = stringifyCSV(displayableCorrectedContactsData); const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' }); const link = document.createElement('a'); const url = URL.createObjectURL(blob); const baseFileName = fileName.replace('_with_urls.csv', '').replace(/\.(csv|xlsx|xls)$/i, ''); const contactsFileName = `${baseFileName}_corrected_contacts.csv`; link.setAttribute('href', url); link.setAttribute('download', contactsFileName); link.style.visibility = 'hidden'; document.body.appendChild(link); link.click(); document.body.removeChild(link); setStatusMessage(`Corrected Contacts CSV download started as ${contactsFileName}.`); addLog(`Corrected Contacts CSV download started as ${contactsFileName}.`); } catch (err) { console.error('Error downloading corrected contacts CSV:', err); const errorMsg = err instanceof Error ? err.message : String(err); setStatusMessage(`Error preparing Corrected Contacts CSV: ${errorMsg}`); addLog(`Error preparing Corrected Contacts CSV for download: ${errorMsg}`); } finally { setIsLoading(false); } }, [displayableCorrectedContactsData, fileName, addLog]);

  if (!GEMINI_API_KEY) { return <div className="container error-message">Error: Gemini API_KEY is not set. Please ensure the `API_KEY` environment variable is configured.</div>; }
  
  const isAnyTestLoading = isTestingContactCorrection || isTestingPreprocessing || isTestingPlaceholderDescRowDeletion || isTestingMostlyEmptyRowDeletion || isTestingMergingDuplicates || isTestingAiOnPreprocessed || isEstimatingCost || isTestingDescriptionGeneration;
  const isAnyFullLoading = isLoading || isProcessingContactsFull || isPerformingFullPlaceholderDescRowDeletion || isPerformingFullMostlyEmptyRowDeletion || isMergingDuplicatesFull || isGeneratingFullDescriptions;
  const isAnyMajorProcessing = isAnyTestLoading || isAnyFullLoading;
  const canRunAnyProcess = csvData.length > 0 || displayData.trim() !== '';

  return (
    <div className="container">
      <header><h1>AI CSV/Excel Editor - Find Organization URLs & Generate Dossiers</h1></header>
      <main>
        <section className="file-input-section" aria-labelledby="file-input-heading">
          <h2 id="file-input-heading">1. Upload File</h2>
          <p>Upload CSV/Excel. First sheet is "Organizations" (Col A: Name). Optional 2nd Excel sheet is "Contacts" (Col J: "Accounts::::ORG_NAME", Col D: Email). Contacts are auto-corrected & used for URL pre-fill. Col BL (index 63) is for Descriptions.</p>
          <div><label htmlFor="dataFile">Select File (CSV or Excel):</label><input type="file" id="dataFile" accept=".csv, .xlsx, .xls, application/vnd.ms-excel, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={handleFileChange} disabled={isAnyMajorProcessing} aria-describedby="dataFileHelp" /><small id="dataFileHelp" className="help-text">Data processed locally. Info sent to AI for URL finding & dossier generation.</small></div>
        </section>
        {(canRunAnyProcess) && (<section className="data-display-section" aria-labelledby="data-display-heading"><h2 id="data-display-heading">2. View and Edit Main Data (JSON format)</h2><label htmlFor="csvDataTable">Main Organizations Data (JSON - editable):</label><textarea id="csvDataTable" value={displayData} onChange={(e) => { setDisplayData(e.target.value); addLog("User manually edited data in main JSON display area."); }} rows={10} spellCheck="false" disabled={isAnyMajorProcessing} aria-label="Editable main organizations data in JSON array-of-arrays format" /><small className="help-text">Main Organizations data. All processing steps below use or update this.</small></section>)}
        
        {canRunAnyProcess && (
            <section className="test-processing-section" aria-labelledby="test-processing-heading">
                <h2 id="test-processing-heading">3. Test Processing (First {TEST_DATA_ROW_COUNT} Data Rows)</h2><p>Test steps on a sample. Results here do not modify main data in Section 2.</p>
                <div className="test-step"><h3 style={{marginTop: 0}}>Test 3.1: Contact Account Correction</h3><button onClick={handleContactCorrectionTest} disabled={isAnyTestLoading || !originalContactsSampleForCorrectionTestDisplay} style={{ backgroundColor: '#ffc107', color: '#212529' }}>{isTestingContactCorrection ? 'Testing...' : `Run Contact Account Correction Test`}</button>{!originalContactsSampleForCorrectionTestDisplay && <small className="help-text help-inline">(Excel with 2nd sheet for Contacts needed)</small>}<DataTableDisplay data={originalContactsSampleForCorrectionTestDisplay} caption={`Original Contacts Sample (First ${TEST_DATA_ROW_COUNT} Contacts - Before Correction)`} /><DataTableDisplay data={correctedContactsTestDataForTable} caption="Corrected Contacts Sample (Test Output - After Correction)" /></div>
                <div className="test-step"><h3 style={{marginTop: 0}}>Test 3.2: Org URL Pre-processing (from Corrected Contacts)</h3><button onClick={handlePreprocessingTest} disabled={isAnyTestLoading || !canRunAnyProcess} style={{ backgroundColor: '#6c757d' }}>{isTestingPreprocessing ? 'Testing...' : `Run Org URL Pre-processing Test`}</button><DataTableDisplay data={preprocessedTestDataForTable} caption={`Org URL Pre-processing Test Output (First ${TEST_DATA_ROW_COUNT} Orgs)`} /></div>
                <div className="test-step"><h3 style={{marginTop: 0}}>Test 3.3: Delete Rows by Placeholder Description</h3><button onClick={handlePlaceholderDescRowDeletionTest} disabled={isAnyTestLoading || !canRunAnyProcess} style={{ backgroundColor: '#dc3545', color: 'white' }}>{isTestingPlaceholderDescRowDeletion ? 'Testing...' : `Run Placeholder Row Deletion Test`}</button><small className="help-text help-inline">(Uses output from Test 3.2 if available)</small><DataTableDisplay data={deletedPlaceholderDescRowsTestDataForTable} caption={`Placeholder Row Deletion Test Output`} /></div>
                <div className="test-step"><h3 style={{marginTop: 0}}>Test 3.4: Delete Mostly Empty Rows</h3><button onClick={handleMostlyEmptyRowsTest} disabled={isAnyTestLoading || !canRunAnyProcess} style={{ backgroundColor: '#fd7e14', color: 'white' }}>{isTestingMostlyEmptyRowDeletion ? 'Testing...' : `Run Mostly Empty Row Deletion Test`}</button><small className="help-text help-inline">(Uses output from Test 3.3 if available)</small><DataTableDisplay data={deletedMostlyEmptyRowsTestDataForTable} caption={`Mostly Empty Row Deletion Test Output`} /></div>
                <div className="test-step"><h3 style={{marginTop: 0}}>Test 3.5: Merge Duplicate Organizations</h3><button onClick={handleMergeDuplicatesTest} disabled={isAnyTestLoading || !canRunAnyProcess} style={{ backgroundColor: '#ff8c00' }}>{isTestingMergingDuplicates ? 'Testing...' : `Run Merge Duplicates Test`}</button><small className="help-text help-inline">(Uses output from Test 3.4 if available)</small><DataTableDisplay data={mergedTestDataForTable} caption={`Merge Duplicates Test Output`} /></div>
                <div className="test-step"><h3 style={{marginTop: 0}}>Test 3.6: AI URL Finding (on Cleaned & Merged Sample)</h3><button onClick={handleAiTestOnPreprocessedData} disabled={isAnyTestLoading || !(mergedTestDataForTable || deletedMostlyEmptyRowsTestDataForTable || deletedPlaceholderDescRowsTestDataForTable || preprocessedTestDataForTable)} style={{ backgroundColor: '#28a745' }}>{isTestingAiOnPreprocessed ? 'Testing AI...' : `Run AI URL Finding Test`}</button><small className="help-text help-inline">(Uses output from previous successful test step)</small><DataTableDisplay data={aiTestedDataForTable} caption={`AI URL Finding Test Output`} /></div>
                <div className="test-step"><h3 style={{marginTop: 0}}>Test 3.7: Generate Detailed Dossier (First Data Row)</h3><button onClick={handleTestDescriptionGeneration} disabled={isAnyTestLoading || !canRunAnyProcess } style={{ backgroundColor: '#6610f2', color: 'white' }}>{isTestingDescriptionGeneration ? 'Generating...' : 'Run Dossier Generation Test'}</button><small className="help-text help-inline">(Uses first data row from current main display)</small><textarea id="dossierTestOutput" value={detailedDescriptionTestOutput ?? 'Dossier output will appear here...'} readOnly rows={8} style={{width:'100%', whiteSpace: 'pre-wrap', fontFamily:'monospace', fontSize: '0.85em', marginTop:'0.5rem', backgroundColor: '#e9ecef'}}></textarea></div>
            </section>
        )}

        {canRunAnyProcess && (
          <section className="ai-prompt-section" aria-labelledby="ai-action-heading">
            <h2 id="ai-action-heading">4. Process Full Data (from Section 2)</h2><p>Run these steps in order. Each step uses/updates the main data in Section 2.</p>
            <div className="button-group"><button onClick={handleFullContactsPreprocessing} disabled={isAnyMajorProcessing || !rawContactsSheetData || !canRunAnyProcess } style={{ backgroundColor: '#17a2b8' }}>{isProcessingContactsFull ? 'Pre-filling...' : 'Step 1: Pre-fill Full Data from Contacts'}</button>{!rawContactsSheetData && <small className="help-text help-inline">(Requires Excel with contacts sheet)</small>}</div>
            <div className="button-group"><button onClick={handleFullPlaceholderDescRowDeletion} disabled={isAnyMajorProcessing || !canRunAnyProcess} style={{ backgroundColor: '#c82333', color: 'white' }}>{isPerformingFullPlaceholderDescRowDeletion ? 'Deleting...' : 'Step 1.3 (Optional): Delete Placeholder Desc Rows'}</button></div>
            <div className="button-group"><button onClick={handleFullMostlyEmptyRows} disabled={isAnyMajorProcessing || !canRunAnyProcess} style={{ backgroundColor: '#e0a800', color: '#212529' }}>{isPerformingFullMostlyEmptyRowDeletion ? 'Deleting...' : 'Step 1.4 (Optional): Delete Mostly Empty Rows'}</button></div>
            <div className="button-group"><button onClick={handleMergeDuplicateOrganizations} disabled={isAnyMajorProcessing || !canRunAnyProcess } style={{ backgroundColor: '#ff8c00' }}>{isMergingDuplicatesFull ? 'Merging...' : 'Step 1.6 (Optional): Merge Duplicate Orgs'}</button></div>
            <div className="button-group"><button onClick={handleFindUrlsWithAi} disabled={isAnyMajorProcessing || !canRunAnyProcess} style={{ backgroundColor: '#007bff' }}>{isLoading ? 'AI Processing (URL Finding)...' : 'Step 2: AI Find Missing URLs (Batches)'}</button></div>
            <div className="button-group"><button onClick={handleGenerateFullDescriptions} disabled={isAnyMajorProcessing || !canRunAnyProcess} style={{ backgroundColor: '#6f42c1', color: 'white' }}>{isGeneratingFullDescriptions ? 'AI Generating Dossiers (Row by Row)...' : 'Step 3: Generate Detailed Dossiers (AI - Full Data)'}</button></div>
          </section>
        )}

        {aiGroundingSources.length > 0 && (<section aria-labelledby="grounding-sources-heading"><h3 id="grounding-sources-heading">AI Search Insights (from last URL finding run)</h3><p>AI may have used info from (not all found URLs):</p><ul className="grounding-sources-list">{aiGroundingSources.map((source, index) => (<li key={index}><a href={String(source.web?.uri ?? '')} target="_blank" rel="noopener noreferrer" title={String(source.web?.uri ?? '')}>{String(source.web?.title || source.web?.uri || '')}</a></li>))}</ul></section>)}
        
        <section className="download-section" aria-labelledby="download-heading">
          <h2 id="download-heading">5. Download Files</h2>
          <button onClick={handleDownloadCsv} disabled={isAnyMajorProcessing || !canRunAnyProcess}>{isLoading ? 'Processing...' : `Download Main Data (${fileName})`}</button>
          <button onClick={handleDownloadCorrectedContactsCsv} disabled={isAnyMajorProcessing || !displayableCorrectedContactsData}>
            {isLoading ? 'Processing...' : `Download Corrected Contacts Data`}
          </button>
          {!displayableCorrectedContactsData && <small className="help-text help-inline">(Corrected Contacts download available if Excel with 2nd sheet was uploaded)</small>}
        </section>

        <section className="usage-stats-section" aria-labelledby="usage-stats-heading">
            <h2 id="usage-stats-heading">6. AI Usage & Cost Estimation</h2>
            <button onClick={handleEstimateFullAiRunCost} disabled={isAnyMajorProcessing || !canRunAnyProcess} style={{backgroundColor: '#5a28a7', marginBottom: '1rem', color: 'white'}}>
                {isEstimatingCost ? 'Estimating...' : 'Estimate Cost for Next Full URL Finding Run'}
            </button>
            {preRunEstimation && (
                <div className="estimation-details">
                    <h4>Pre-Run Estimation (for Full AI URL Finding on current data):</h4>
                    <p>Est. Input Tokens (Flash Model): {preRunEstimation.inputTokens.toLocaleString()}</p>
                    <p>Est. API Requests (Grounding): {preRunEstimation.apiRequests.toLocaleString()}</p>
                    <p>Est. Input & Grounding Cost (USD): ${preRunEstimation.estimatedInputCost.toFixed(4)}</p>
                    <small><em>Note: This pre-run estimate does NOT include output token costs (Flash model) or any costs related to Dossier Generation (Pro model). Grounding cost assumes requests might exceed the daily free tier.</em></small>
                </div>
            )}
            {(currentOperationStats.operationType || currentOperationStats.status !== 'idle') && (
                 <div className="estimation-details" style={{marginTop: '1rem'}}>
                    <h4>{currentOperationStats.status === 'running' || currentOperationStats.status === 'estimating_input' ? 'Current' : 'Last'} AI Operation Details:</h4>
                    <p>Operation: {currentOperationStats.operationType || 'N/A'}</p>
                    <p>Model Used: {currentOperationStats.modelUsed || 'N/A'}</p>
                    <p>Status: {currentOperationStats.status} {currentOperationStats.progressMessage && `- ${currentOperationStats.progressMessage}`}</p>
                    <p>Input Tokens: {currentOperationStats.inputTokens.toLocaleString()}</p>
                    <p>Output Tokens: {currentOperationStats.outputTokens.toLocaleString()}</p>
                    <p>API Requests (for grounding): {currentOperationStats.apiRequests.toLocaleString()}</p>
                    <p>Est. Cost for this Operation (USD): ${currentOperationStats.estimatedCost.toFixed(4)}</p>
                </div>
            )}
             <div className="estimation-details" style={{marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #eee'}}>
                <h4>Cumulative Session Totals (All AI Operations):</h4>
                <ul>
                    <li>Total Input Tokens: {totalInputTokens.toLocaleString()}</li>
                    <li>Total Output Tokens: {totalOutputTokens.toLocaleString()}</li>
                    <li>Total API Requests (for grounding): {totalApiRequestsMade.toLocaleString()}</li>
                    <li>Estimated Cumulative Session Cost (USD): ${estimatedCost.toFixed(4)}</li>
                </ul>
            </div>
            <small className="help-text" style={{marginTop: '1rem'}}>
                Flash Model ({'gemini-2.5-flash-preview-04-17'}) Costs: Input ${FLASH_PRICE_INPUT_PER_MILLION_TOKENS}/1M, Output (Thinking) ${FLASH_PRICE_OUTPUT_THINKING_PER_MILLION_TOKENS}/1M.<br/>
                Pro Model ({'gemini-2.5-pro-preview-04-17'}) Costs (<=200k prompts): Input ${PRO_PRICE_INPUT_PER_MILLION_TOKENS}/1M, Output ${PRO_PRICE_OUTPUT_PER_MILLION_TOKENS}/1M.<br/>
                Grounding with Google Search: First {FLASH_FREE_GROUNDING_REQUESTS_PER_DAY} requests/day free (for URL Finding). Additional requests ~$${FLASH_PRICE_GROUNDING_PER_THOUSAND_REQUESTS_AFTER_FREE_TIER}/1000. Cumulative cost includes an estimate for grounding.
            </small>
        </section>
        <section className="activity-log-section" aria-labelledby="activity-log-heading">
          <h2 id="activity-log-heading">Activity Log</h2>
          <textarea id="activityLog" ref={activityLogRef} value={activityLog.join('\n')} readOnly rows={10} aria-live="polite" aria-atomic="false" className="activity-log-area" />
        </section>
      </main>
      {statusMessage && (<div className={`status-message ${statusMessage.toLowerCase().includes('error') ? 'error-message' : ''}`} role="status" aria-live="polite">{statusMessage}</div>)}
    </div>
  );
};

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(<React.StrictMode><App /></React.StrictMode>);
} else {
  console.error("Root element not found. App could not be mounted.");
  const errorDiv = document.createElement('div');
  errorDiv.textContent = "Critical Error: HTML root element not found. App cannot start.";
  errorDiv.style.color = "red"; errorDiv.style.padding = "20px"; errorDiv.style.textAlign = "center";
  document.body.prepend(errorDiv);
}
