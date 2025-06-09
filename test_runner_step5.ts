// test_runner_step5.ts

// --- Configuration ---
const BATCH_SIZE_FOR_AI_TEST = 10;

// --- Simplified State Variables ---
let test_statusMessage: string = '';
let test_activityLog: string[] = [];
let test_displayData: string[][] = []; // Simulates main data loaded/processed
let test_rawContactsSheetData: string[][] | null = null; // For pre-fill test
let test_preRunEstimation: { inputTokens: number; apiRequests: number; estimatedInputCost: number; } | null = null;
let test_skippedBatchNumbers: number[] = [];
let test_aiGroundingSources: any[] = [];

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
  operationType: null, status: 'idle', inputTokens: 0, outputTokens: 0,
  apiRequests: 0, estimatedCost: 0, modelUsed: null, progressMessage: '',
};
let test_currentOperationStats: CurrentOperationStats = { ...initialCurrentOperationStats };

let test_totalInputTokens: number = 0;
let test_totalOutputTokens: number = 0;
let test_totalApiRequestsMade: number = 0;
let test_cumulativeEstimatedCost: number = 0;

// --- Constants ---
const FLASH_PRICE_INPUT_PER_MILLION_TOKENS = 0.15;
const FLASH_PRICE_OUTPUT_THINKING_PER_MILLION_TOKENS = 3.50;
const FLASH_PRICE_GROUNDING_PER_THOUSAND_REQUESTS_AFTER_FREE_TIER = 35;
const FLASH_FREE_GROUNDING_REQUESTS_PER_DAY = 0; // Assume no free tier for testing cost calculation path

const GENERIC_EMAIL_DOMAINS = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com'];

// --- Logging and State Update Functions ---
const addLog = (message: string) => {
  const logEntry = `[${new Date().toLocaleTimeString()}] ${message}`;
  test_activityLog.push(logEntry);
  console.log(`LOG: ${logEntry}`);
};
const setStatus = (message: string) => { test_statusMessage = message; addLog(message); console.log(`STATUS: ${message}`); };

const resetTestState = (caseNumber: string) => {
  addLog(`--- Resetting State for Test Case ${caseNumber} ---`);
  // Don't reset cumulative totals to test accumulation across cases if needed,
  // but for these specific tests, we want to see per-operation effects clearly.
  // test_displayData and other specific states will be set by each test case.
  test_currentOperationStats = { ...initialCurrentOperationStats };
  test_preRunEstimation = null;
  test_skippedBatchNumbers = [];
  test_aiGroundingSources = [];
};

// --- Helper Functions (parseCSV, isPlausibleUrl, etc.) ---
const parseCSV = (csvText: string): string[][] => {
  const lines = csvText.split('\n').filter(line => String(line ?? '').trim() !== '');
  return lines.map(line => {
    const values: string[] = []; let currentField = ''; let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && i + 1 < line.length && line[i+1] === '"') { currentField += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (char === ',' && !inQuotes) {
        values.push(String(currentField ?? '').trim()); currentField = '';
      } else { currentField += char; }
    }
    values.push(String(currentField ?? '').trim()); return values;
  });
};

const normalizeUrlForComparison = (url: string): string => {
  let normalized = String(url ?? '').trim().toLowerCase();
  if (normalized.startsWith('http://')) normalized = normalized.substring(7);
  else if (normalized.startsWith('https://')) normalized = normalized.substring(8);
  if (normalized.startsWith('www.')) normalized = normalized.substring(4);
  if (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  return normalized;
};

const isPlausibleUrl = (url: string): boolean => {
  const trimmedUrl = String(url ?? '').trim();
  if (trimmedUrl === '') return false; if (!trimmedUrl.includes('.')) return false;
  if (trimmedUrl.includes('@') && GENERIC_EMAIL_DOMAINS.some(domain => trimmedUrl.endsWith(domain))) return false;
  if (GENERIC_EMAIL_DOMAINS.some(domain => normalizeUrlForComparison(trimmedUrl) === domain)) return false;
  return true;
};

const extractDomainFromEmail = (email: string): string | null => {
    if (!email || typeof email !== 'string') return null;
    const atIndex = email.lastIndexOf('@');
    if (atIndex === -1 || atIndex === email.length - 1) return null;
    return email.substring(atIndex + 1).toLowerCase();
};

const calculateOperationCost = (inputTokens: number, outputTokens: number, apiRequests: number, modelType: 'flash' | 'pro'): number => {
  let inputCost = 0; let outputCost = 0; let groundingCost = 0;
  if (modelType === 'flash') {
    inputCost = (inputTokens / 1000000) * FLASH_PRICE_INPUT_PER_MILLION_TOKENS;
    outputCost = (outputTokens / 1000000) * FLASH_PRICE_OUTPUT_THINKING_PER_MILLION_TOKENS;
    // Simplified grounding for test: assume each API request is billable beyond free tier
    const billableRequests = Math.max(0, apiRequests - FLASH_FREE_GROUNDING_REQUESTS_PER_DAY);
    groundingCost = (billableRequests / 1000) * FLASH_PRICE_GROUNDING_PER_THOUSAND_REQUESTS_AFTER_FREE_TIER;

  } // Pro model not in this test's scope for cost
  return inputCost + outputCost + groundingCost;
};

const cleanAiNotFoundResponses = (data: string[][]): string[][] => {
  if (!data || data.length === 0) return data;
  const notFoundPlaceholders = ["url_not_found", "no official website found", "not found", "n/a", "null", "undefined"]
    .map(p => p.toLowerCase());
  const cleanedData = data.map(row => row.map(cell => String(cell ?? '')));
  for (let i = 1; i < cleanedData.length; i++) { // Start from 1 to skip header
    const row = cleanedData[i];
    if (row.length > 1) { // URL is at index 1
      const cellValue = String(row[1] ?? '');
      if (cellValue.trim() !== '' && notFoundPlaceholders.includes(cellValue.trim().toLowerCase())) {
        row[1] = "";
      }
    }
  }
  return cleanedData;
};


// --- Data Generation Functions ---
const generateFullOrgsData = (numRows: number, numWithoutUrlsStart: number): string[][] => {
    const data: string[][] = [["Organization Name", "Website URL", "Industry", "Description (Col 63)"]];
    let withoutUrlsCount = 0;
    for (let i = 1; i <= numRows; i++) {
        let url = `www.org${i}.com`;
        if (withoutUrlsCount < numWithoutUrlsStart) {
            url = '';
            withoutUrlsCount++;
        }
        data.push([`Org ${i}`, url, (i % 2 === 0) ? "Tech" : "Services", `Description for Org ${i}`]);
    }
    return data;
};

const generateFullContactsData = (orgsList: string[][], numOrgsToHaveContacts: number, numWithNonGeneric: number): string[][] => {
    const contacts: string[][] = [["FirstName", "LastName", "Email", "Title", "Accounts::::ORG_NAME"]];
    let nonGenericAssigned = 0;
    let orgsWithContactsAssigned = 0;

    for (let i = 1; i < orgsList.length; i++) { // Skip header of orgsList
        if (orgsWithContactsAssigned >= numOrgsToHaveContacts) break;
        const orgName = orgsList[i][0];
        let emailDomain = `generic${i}.com`; // Default to a unique generic-like domain
        if (GENERIC_EMAIL_DOMAINS.length > 0 && orgsWithContactsAssigned % 2 !== 0) { // Make some generic for real
            emailDomain = GENERIC_EMAIL_DOMAINS[orgsWithContactsAssigned % GENERIC_EMAIL_DOMAINS.length];
        }

        if (nonGenericAssigned < numWithNonGeneric) {
            emailDomain = `domain${i}.com`; // Non-generic
            nonGenericAssigned++;
        }
        contacts.push([`Contact`, `User${i}`, `contact${i}@${emailDomain}`, `Employee`, `Accounts::::${orgName}`]);
        orgsWithContactsAssigned++;
    }
    return contacts;
};


// --- Core Logic Functions (Prefill, Estimate, Full AI Run) ---
// (Prefill from test_runner_step2, adapted for current state var names)
const prefillUrlsFromContactsLogic = (orgsData: string[][], contactsData: string[][]): { updatedOrgsData: string[][], prefilledCount: number } => {
    addLog("Full URL Pre-fill: Starting process.");
    let prefilledCount = 0;
    const updatedOrgsData = orgsData.map(orgRow => [...orgRow.map(cell => String(cell ?? ''))]);
    if (updatedOrgsData.length > 0) {
        const header = updatedOrgsData[0]; while (header.length < 2) header.push('');
        if (String(header[1] ?? '').trim() === '') header[1] = "Website URL";
    }
    for (let i = 1; i < updatedOrgsData.length; i++) {
        const orgRow = updatedOrgsData[i]; const orgName = String(orgRow[0] ?? '').trim();
        if (!orgName) continue; while (orgRow.length < 2) orgRow.push('');
        if (isPlausibleUrl(String(orgRow[1] ?? ''))) {
             const existingUrl = String(orgRow[1] ?? '');
             if (!GENERIC_EMAIL_DOMAINS.some(genDomain => normalizeUrlForComparison(existingUrl).endsWith(genDomain))) {
                 addLog(`Full URL Pre-fill: Skipped for "${orgName}", plausible URL "${existingUrl}" exists.`); continue;
            }
        }
        for (const contactRow of contactsData.slice(1)) {
            const accountCell = String(contactRow[4] ?? '').trim();
            if (accountCell.toLowerCase().startsWith("accounts::::")) {
                const contactOrgName = accountCell.substring("accounts::::".length).trim();
                if (contactOrgName.toLowerCase() === orgName.toLowerCase()) {
                    const email = String(contactRow[2] ?? '').trim();
                    if (email) {
                        const domain = extractDomainFromEmail(email);
                        if (domain && !GENERIC_EMAIL_DOMAINS.includes(domain)) {
                            orgRow[1] = domain; prefilledCount++;
                            addLog(`Full URL Pre-fill: Filled for "${orgName}" with "${domain}".`); break;
                        } else if (domain && GENERIC_EMAIL_DOMAINS.includes(domain)) {
                             addLog(`Full URL Pre-fill: Skipped for "${orgName}", domain "${domain}" from email "${email}" is generic.`);
                        }
                    }
                }
            }
        }
    }
    addLog(`Full URL Pre-fill: Process complete. ${prefilledCount} URLs filled.`);
    return { updatedOrgsData, prefilledCount };
};

// Logic for handleEstimateFullAiRunCost (adapted from index.tsx)
const estimateFullAiRunCostLogic = async () => {
    addLog("Cost Estimation: Initiating for Full AI URL Finding Run.");
    test_currentOperationStats = { operationType: null, status: 'estimating_input', inputTokens: 0, outputTokens: 0, apiRequests: 0, estimatedCost: 0, modelUsed: 'gemini-2.5-flash-preview-04-17', progressMessage: 'Estimating URL finding costs...' };

    if (!test_displayData || test_displayData.length < 2) {
        setStatus("Cost Estimation: Not enough data loaded."); return;
    }
    const modelToUse = 'gemini-2.5-flash-preview-04-17';
    let totalEstimatedInputTokens = 0; let totalEstimatedApiRequests = 0;
    const headerRow = test_displayData[0]; const dataRows = test_displayData.slice(1);
    const totalBatches = Math.ceil(dataRows.filter(row => !isPlausibleUrl(String(row[1] ?? ''))).length / BATCH_SIZE_FOR_AI_TEST); // Estimate batches based on items needing URLs

    addLog(`Cost Estimation: Processing ${dataRows.length} data rows in an estimated ${totalBatches} potential batches (BATCH_SIZE=${BATCH_SIZE_FOR_AI_TEST}).`);

    for (let i = 0; i < Math.ceil(dataRows.length / BATCH_SIZE_FOR_AI_TEST); i++) {
        const batchStart = i * BATCH_SIZE_FOR_AI_TEST;
        const batchEnd = batchStart + BATCH_SIZE_FOR_AI_TEST;
        const currentChunk = dataRows.slice(batchStart, batchEnd);
        const itemsRequiringAiLookup = currentChunk.filter(row => !isPlausibleUrl(String(row[1] ?? '')));
        if (itemsRequiringAiLookup.length > 0) {
            totalEstimatedApiRequests++;
            const dataForAISubmission = [headerRow, ...itemsRequiringAiLookup];
            const dataToSendString = JSON.stringify(dataForAISubmission);
            const prompt = `Estimate prompt for: <data>${dataToSendString}</data> ...`; // Simplified
            const promptTokenContents = [{role: 'user', parts: [{text: prompt}]}];
            try {
                // Corrected to use mockGenAIFullRun
                const batchTokens = await mockGenAIFullRun.models.countTokens({ contents: promptTokenContents, model: modelToUse });
                totalEstimatedInputTokens += batchTokens;
                addLog(`Cost Estimation: Batch ${i+1} (with ${itemsRequiringAiLookup.length} items) - Est. Input Tokens: ${batchTokens}`);
            } catch (e:any) { addLog(`Cost Estimation: Error counting tokens for batch ${i+1}: ${e.message}`); }
        } else { addLog(`Cost Estimation: Batch ${i+1} - All ${currentChunk.length} rows have plausible URLs. No AI call estimated.`);}
    }
    const estimatedTotalCost = calculateOperationCost(totalEstimatedInputTokens, 0, totalEstimatedApiRequests, 'flash');
    test_preRunEstimation = { inputTokens: totalEstimatedInputTokens, apiRequests: totalEstimatedApiRequests, estimatedInputCost: estimatedTotalCost };
    addLog(`Cost Estimation Complete: Total Est. Input Tokens: ${totalEstimatedInputTokens}, Total Est. API Requests: ${totalEstimatedApiRequests}, Est. Cost: $${estimatedTotalCost.toFixed(4)}`);
    setStatus('Full AI URL Finding cost estimation complete.');
    test_currentOperationStats.status = 'completed';
};

// --- Mocked AI for Full Run ---
let aiBatchCallCount = 0;
let forceErrorOnBatch = -1; // -1 for no error, or batch number (1-indexed) to fail once

const mockGenAIFullRun = {
    models: {
        generateContent: async (params: { model: string, contents: any[] }) => {
            aiBatchCallCount++;
            addLog(`Mock AI (Full Run): generateContent called (Attempt ${aiBatchCallCount} for current logical batch). Batch: ${test_currentOperationStats.progressMessage}`);

            if (forceErrorOnBatch === aiBatchCallCount && forceErrorOnBatch !== -1) { // Fail only on the specified attempt for that batch
                addLog(`Mock AI (Full Run): Simulating error for batch processing, attempt ${aiBatchCallCount}.`);
                forceErrorOnBatch = -1; // Reset for next time or next batch
                throw new Error("Simulated AI API Error for batch retry test.");
            }

            const inputText = params.contents[0].parts[0].text;
            const inputDataMatch = inputText.match(/<data>(.*?)<\/data>/);
            const inputData = inputDataMatch ? JSON.parse(inputDataMatch[1]) : [];
            const responseData = [inputData[0]]; // header
            let urlsFoundThisBatch = 0;

            for (let i = 1; i < inputData.length; i++) { // For each row in this batch
                const orgName = inputData[i][0];
                let foundUrl = "";
                if (orgName.includes("1") || orgName.includes("3") || orgName.includes("5") || orgName.includes("7") || orgName.includes("9")) { // Find for odd Org numbers in batch
                    foundUrl = `${orgName.replace(/ /g, '').toLowerCase()}.com`;
                    urlsFoundThisBatch++;
                }
                responseData.push([orgName, foundUrl, inputData[i][2], inputData[i][3]]);
            }
            addLog(`Mock AI (Full Run): Responding with ${urlsFoundThisBatch} URLs for this batch.`);
            return Promise.resolve({
                text: () => JSON.stringify(responseData),
                candidates: [{ groundingMetadata: { groundingChunks: [{ web: { uri: `https://mocksource.batch/${aiBatchCallCount}`, title: `Mock Source Batch ${aiBatchCallCount}` } }] } }]
            });
        },
        countTokens: async (params: { contents: any[], model: string }): Promise<number> => {
            const textContent = params.contents[0].parts[0].text;
            if (textContent.startsWith("Estimate prompt for:")) return Promise.resolve(50); // For estimation
            if (params.contents[0].role === 'user') return Promise.resolve(70); // For actual run prompt
            return Promise.resolve(40); // For actual run response
        }
    }
};

// Logic for handleFindUrlsWithAi (adapted from index.tsx)
const findUrlsWithAiLogic = async () => {
    addLog("Full AI URL Finding: Initiated.");
    if (!test_displayData || test_displayData.length < 2) { setStatus("Full AI: No data loaded."); return; }

    const modelToUse = 'gemini-2.5-flash-preview-04-17';
    test_currentOperationStats = { operationType: 'full_url', status: 'running', inputTokens: 0, outputTokens: 0, apiRequests: 0, estimatedCost: 0, modelUsed: modelToUse, progressMessage: 'Starting URL finding...' };
    setStatus('Full AI URL Finding: Starting...');
    test_aiGroundingSources = []; test_skippedBatchNumbers = [];
    let currentRunOpInputTokens = 0; let currentRunOpOutputTokens = 0; let currentRunOpApiRequests = 0;

    const headerRow = test_displayData[0]; const dataRows = test_displayData.slice(1);
    const MAX_RETRIES = 1; // Simplified retry for test

    let allProcessedDataRows: string[][] = [];
    const rowsThatNeedAi = dataRows.filter(row => !isPlausibleUrl(String(row[1] ?? '')));
    const totalBatches = Math.ceil(rowsThatNeedAi.length / BATCH_SIZE_FOR_AI_TEST);
    addLog(`Full AI URL Finding: ${rowsThatNeedAi.length} rows need URLs. Processing in ${totalBatches} batches of size ${BATCH_SIZE_FOR_AI_TEST}.`);

    for (let i = 0; i < totalBatches; i++) {
        const batchStartIdx = i * BATCH_SIZE_FOR_AI_TEST;
        const batchEndIdx = batchStartIdx + BATCH_SIZE_FOR_AI_TEST;
        const currentChunkOfRowsForAI = rowsThatNeedAi.slice(batchStartIdx, batchEndIdx);

        const batchDisplayNum = i + 1;
        const progressMsg = `Processing Batch ${batchDisplayNum} of ${totalBatches} (${currentChunkOfRowsForAI.length} items)...`;
        test_currentOperationStats.progressMessage = progressMsg; addLog(progressMsg);

        const dataToSendToAiForBatch = [headerRow, ...currentChunkOfRowsForAI];
        const dataToSendToAiString = JSON.stringify(dataToSendToAiForBatch);
        const promptForBatch = `For this JSON array...: <data>${dataToSendToAiString}</data> ...`; // Simplified

        let response: any; let retries = 0; let batchSuccess = false;
        let batchInputTokens = 0; let batchOutputTokens = 0; let batchApiRequestAttempted = false;

        const promptTokenContents = [{role: 'user', parts: [{text: promptForBatch}]}];
        batchInputTokens = await mockGenAIFullRun.models.countTokens({contents: promptTokenContents, model: modelToUse});
        currentRunOpInputTokens += batchInputTokens;
        test_currentOperationStats.inputTokens = currentRunOpInputTokens; // Update for current operation

        aiBatchCallCount = 0; // Reset for mock logic that uses this to simulate retries for a *specific batch*

        while(retries <= MAX_RETRIES && !batchSuccess) {
            try {
                if (retries > 0) { addLog(`Full AI: Retrying batch ${batchDisplayNum} (attempt ${retries + 1})...`); }
                else { addLog(`Full AI: Sending Batch ${batchDisplayNum} to AI.`); }

                if (!batchApiRequestAttempted) { // Count API request only on first true attempt of a batch
                    currentRunOpApiRequests++;
                    test_currentOperationStats.apiRequests = currentRunOpApiRequests;
                    batchApiRequestAttempted = true;
                }

                response = await mockGenAIFullRun.models.generateContent({ model: modelToUse, contents: promptTokenContents });
                const aiResponseText = response.text();
                const responseTokenContents = [{role: 'model', parts: [{text: aiResponseText}]}];
                batchOutputTokens = await mockGenAIFullRun.models.countTokens({contents: responseTokenContents, model: modelToUse});
                // Note: in real app, output tokens add up per retry; here, mock is simple and gives fixed value

                const suggestedBatchDataUncleaned = JSON.parse(aiResponseText);
                const suggestedBatchDataFromAI = cleanAiNotFoundResponses(suggestedBatchDataUncleaned);
                const aiProcessedRowsInThisBatch = suggestedBatchDataFromAI.slice(1);

                // Merge this batch's results into its original chunk
                currentChunkOfRowsForAI.forEach((originalRow, k_idx) => {
                    if (aiProcessedRowsInThisBatch[k_idx]) { // if AI provided a row for it
                        originalRow[1] = aiProcessedRowsInThisBatch[k_idx][1]; // Update URL
                    }
                });
                batchSuccess = true;
                if(retries ===0) currentRunOpOutputTokens += batchOutputTokens; // Only add output tokens if first try succeeded for simplicity in mock

                const groundingMeta = response.candidates?.[0]?.groundingMetadata;
                if (groundingMeta?.groundingChunks) test_aiGroundingSources.push(...groundingMeta.groundingChunks);

            } catch (e:any) {
                addLog(`Full AI: Error on batch ${batchDisplayNum}, attempt ${retries + 1}: ${e.message}`); retries++;
                if (retries > MAX_RETRIES) {
                    addLog(`Full AI: Batch ${batchDisplayNum} failed after ${MAX_RETRIES + 1} attempts. Skipping.`);
                    test_skippedBatchNumbers.push(batchDisplayNum);
                }
            }
        }
    }

    // Reconstruct final displayData
    let finalReconstructedData = [headerRow];
    const processedOrgNames = new Set();
    rowsThatNeedAi.forEach(row => { // Add all rows that were attempted by AI (modified or not)
        finalReconstructedData.push(row);
        processedOrgNames.add(String(row[0]).toLowerCase());
    });
    dataRows.forEach(originalDataRow => { // Add rows that didn't need AI
        if (!processedOrgNames.has(String(originalDataRow[0]).toLowerCase())) {
            finalReconstructedData.push(originalDataRow);
        }
    });
    test_displayData = finalReconstructedData;

    test_currentOperationStats.outputTokens = currentRunOpOutputTokens;
    test_currentOperationStats.estimatedCost = calculateOperationCost(test_currentOperationStats.inputTokens, test_currentOperationStats.outputTokens, test_currentOperationStats.apiRequests, 'flash');
    test_currentOperationStats.status = test_skippedBatchNumbers.length > 0 ? 'error' : 'completed';
    test_currentOperationStats.progressMessage = `All URL Batches Processed. ${totalBatches - test_skippedBatchNumbers.length}/${totalBatches} successful.`;

    test_totalInputTokens += test_currentOperationStats.inputTokens;
    test_totalOutputTokens += test_currentOperationStats.outputTokens;
    test_totalApiRequestsMade += test_currentOperationStats.apiRequests;
    test_cumulativeEstimatedCost += test_currentOperationStats.estimatedCost;
    setStatus(`Full AI URL Finding Complete. ${test_currentOperationStats.progressMessage}`);
};


// --- Main Test Execution ---
const runAllFullWorkflowTests = async () => {
    // Test Case 5.1
    resetTestState("5.1");
    test_displayData = generateFullOrgsData(25, 15); // 25 rows, 15 initially without URLs
    test_rawContactsSheetData = generateFullContactsData(test_displayData, 10, 7); // Contacts for 10 of them, 7 non-generic
    addLog("Test 5.1 Setup: Generated orgs and contacts data.");
    const prefillResult = prefillUrlsFromContactsLogic(test_displayData, test_rawContactsSheetData);
    test_displayData = prefillResult.updatedOrgsData;
    console.log("Test 5.1 Verification: Pre-filled URLs count:", prefillResult.prefilledCount);
    console.log("Test 5.1 Verification: Display Data after pre-fill (first 5 rows):", JSON.stringify(test_displayData.slice(0,6),null,2));

    // Test Case 5.2
    resetTestState("5.2");
    // test_displayData is already set from 5.1 output, which is the input for 5.2
    addLog("Test 5.2 Setup: Using displayData from 5.1 output for cost estimation.");
    await estimateFullAiRunCostLogic();
    console.log("Test 5.2 Verification: Pre-run Estimation:", JSON.stringify(test_preRunEstimation, null, 2));
    console.log("Test 5.2 Verification: Current Op Stats:", JSON.stringify(test_currentOperationStats, null, 2));

    // Test Case 5.3 (Normal run)
    resetTestState("5.3 - Normal");
    // test_displayData is still from 5.1 output.
    addLog("Test 5.3 (Normal) Setup: Using displayData from 5.1 output for AI URL finding.");
    forceErrorOnBatch = -1; // No error
    await findUrlsWithAiLogic();
    console.log("Test 5.3 (Normal) Verification: Skipped Batches:", JSON.stringify(test_skippedBatchNumbers));
    console.log("Test 5.3 (Normal) Verification: Display Data after AI run (first 12 rows):", JSON.stringify(test_displayData.slice(0,13),null,2));
    console.log("Test 5.3 (Normal) Verification: Grounding sources count:", test_aiGroundingSources.length);
    console.log("Test 5.3 (Normal) Verification: Current Op Stats:", JSON.stringify(test_currentOperationStats, null, 2));

    // Test Case 5.3 (Retry Logic)
    const displayDataBeforeRetryTest = JSON.parse(JSON.stringify(test_displayData)); // Save for comparison if needed, though findUrlsWithAiLogic uses its own copy
    resetTestState("5.3 - Retry");
    test_displayData = generateFullOrgsData(8, 8); // 8 rows, all needing URLs, for a single batch.
    addLog("Test 5.3 (Retry) Setup: Using 8 new orgs, all needing URLs.");
    forceErrorOnBatch = 1; // Force error on the first attempt of the first logical batch
    const previousApiRequests = test_totalApiRequestsMade; // Track change
    await findUrlsWithAiLogic();
    console.log("Test 5.3 (Retry) Verification: Skipped Batches:", JSON.stringify(test_skippedBatchNumbers));
    console.log("Test 5.3 (Retry) Verification: Display Data after AI run (all 8 rows):", JSON.stringify(test_displayData.slice(0,9),null,2));
    console.log("Test 5.3 (Retry) Verification: API Requests for this run:", test_currentOperationStats.apiRequests);
    console.log("Test 5.3 (Retry) Verification: Activity Log for Retry (last 10):", JSON.stringify(test_activityLog.slice(-10),null,2));


    console.log("\n\n--- All Full Workflow Tests Execution Finished ---");
    console.log("Final Cumulative Cost:", test_cumulativeEstimatedCost.toFixed(6));
    console.log("Final Total Input Tokens:", test_totalInputTokens);
    console.log("Final Total Output Tokens:", test_totalOutputTokens);
    console.log("Final Total API Requests:", test_totalApiRequestsMade);
};

runAllFullWorkflowTests();
console.log("test_runner_step5.ts loaded and tests executed.");
export {};
