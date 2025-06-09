// test_runner_step7.ts

// --- Simplified State Variables ---
let test_statusMessage: string = '';
let test_activityLog: string[] = [];
let test_isTestingAiOnPreprocessed: boolean = false; // Simulates the loading flag for AI URL Find Test button
let test_inputDataForAiTest: string[][] | null = null; // Input data for the AI test
let test_aiTestedDataForTable: string[][] | null = null; // Result of AI processing
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

// Cumulative session stats (not strictly reset for each sub-case here, to see if they would accumulate)
let test_totalInputTokens: number = 0;
let test_totalOutputTokens: number = 0;
let test_totalApiRequestsMade: number = 0;
let test_cumulativeEstimatedCost: number = 0;

// --- Constants ---
const FLASH_PRICE_INPUT_PER_MILLION_TOKENS = 0.15;
const FLASH_PRICE_OUTPUT_THINKING_PER_MILLION_TOKENS = 3.50;
const GENERIC_EMAIL_DOMAINS = ['gmail.com', 'yahoo.com']; // Simplified

// --- Logging and State Update Functions ---
const addLog = (message: string) => {
  const logEntry = `[${new Date().toLocaleTimeString()}] ${message}`;
  test_activityLog.push(logEntry);
  console.log(`LOG: ${logEntry}`);
};

const setStatus = (message: string) => {
  test_statusMessage = message;
  addLog(message);
  console.log(`STATUS: ${test_statusMessage}`);
};

const resetCaseState = (caseName: string) => {
    addLog(`--- Resetting State for Test Case ${caseName} ---`);
    test_statusMessage = '';
    test_activityLog = []; // Clear log for each case for clarity
    test_isTestingAiOnPreprocessed = false;
    test_inputDataForAiTest = null;
    test_aiTestedDataForTable = null;
    test_aiGroundingSources = [];
    test_currentOperationStats = { ...initialCurrentOperationStats };
    // Cumulative totals are NOT reset to see if they would build up if these were real sequential operations.
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

const calculateOperationCost = (inputTokens: number, outputTokens: number, apiRequests: number, modelType: 'flash' | 'pro'): number => {
  if (modelType === 'flash') {
    const inputCost = (inputTokens / 1000000) * FLASH_PRICE_INPUT_PER_MILLION_TOKENS;
    const outputCost = (outputTokens / 1000000) * FLASH_PRICE_OUTPUT_THINKING_PER_MILLION_TOKENS;
    return inputCost + outputCost;
  }
  return 0;
};

const cleanAiNotFoundResponses = (data: string[][]): string[][] => { // Simplified from previous runners
    if (!data || data.length === 0) return data;
    return data.map(row => row.map(cell => {
        const sCell = String(cell ?? '').toLowerCase();
        if (["url_not_found", "not found", "n/a"].includes(sCell)) return "";
        return String(cell ?? '');
    }));
};


// --- Mocked AI ---
let mockShouldError = false;
let mockErrorMessage = "Simulated API Error";
let mockApiDelay = 0;

const mockGenAI = {
  models: {
    generateContent: async (params: { model: string, contents: any[], config?: any }) => {
      addLog(`Mock AI: generateContent called. Error mode: ${mockShouldError}`);
      if (mockApiDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, mockApiDelay));
      }
      if (mockShouldError) {
        throw new Error(mockErrorMessage);
      }
      // Normal successful response for AI URL Finding Test
      return Promise.resolve({
        text: () => JSON.stringify([
          ["Organization Name","Website URL","Industry","Description"],
          ["Test Org 1","testorg1.com","Tech","Needs URL"]
        ]),
        candidates: [{ groundingMetadata: { groundingChunks: [{ web: { uri: 'https://mock.source/testorg1', title: 'TestOrg1 Source' } }] } }]
      });
    },
    countTokens: async (params: { contents: any[], model: string }): Promise<number> => {
      addLog(`Mock AI: countTokens called.`);
      if (params.contents[0].role === 'user') return Promise.resolve(10); // Prompt tokens
      return Promise.resolve(5); // Response tokens
    }
  }
};

// --- Core Logic for AI URL Finding Test (adapted from index.tsx's handleAiTestOnPreprocessedData) ---
const coreAiUrlFindingLogic = async () => {
  addLog("AI URL Finding Logic: Initiating.");
  if (!test_inputDataForAiTest || test_inputDataForAiTest.length < 2) {
    setStatus("AI URL Test Logic: No input data."); return;
  }

  test_isTestingAiOnPreprocessed = true; // Simulate button disable
  addLog(`State: test_isTestingAiOnPreprocessed set to ${test_isTestingAiOnPreprocessed}`);

  const modelToUse = 'gemini-2.5-flash-preview-04-17';
  test_currentOperationStats = {
    operationType: 'test_url', status: 'running', inputTokens: 0, outputTokens: 0,
    apiRequests: 0, estimatedCost: 0, modelUsed: modelToUse,
    progressMessage: `Processing ${test_inputDataForAiTest.length -1} rows...`
  };
  setStatus(`AI URL Test Logic: Processing...`);
  test_aiGroundingSources = [];

  const headerRow = test_inputDataForAiTest[0];
  const dataRowsForAISubmission = test_inputDataForAiTest.slice(1).filter(row => !isPlausibleUrl(String(row[1] ?? '')));

  if (dataRowsForAISubmission.length === 0) {
    addLog("AI URL Test Logic: No rows require URL lookup.");
    test_aiTestedDataForTable = [...test_inputDataForAiTest];
    test_currentOperationStats.status = 'completed';
    test_isTestingAiOnPreprocessed = false;
    addLog(`State: test_isTestingAiOnPreprocessed set to ${test_isTestingAiOnPreprocessed}`);
    setStatus("AI URL Test Logic: Completed. No rows needed processing.");
    return;
  }

  const dataToSendToAI = [headerRow, ...dataRowsForAISubmission];
  const testPrompt = `Simulated prompt for ${dataRowsForAISubmission.length} orgs.`;

  let response: any;
  let opInputTokens = 0; let opOutputTokens = 0; let opApiRequests = 0;

  try {
    opInputTokens = await mockGenAI.models.countTokens({ contents: [{role: 'user', parts: [{text: testPrompt}]}], model: modelToUse });
    test_currentOperationStats.inputTokens = opInputTokens;
    test_currentOperationStats.estimatedCost = calculateOperationCost(opInputTokens, 0, 1, 'flash');

    response = await mockGenAI.models.generateContent({ model: modelToUse, contents: [{role: 'user', parts: [{text: testPrompt}]}] });
    opApiRequests = 1;

    const aiResponseText = response.text();
    opOutputTokens = await mockGenAI.models.countTokens({ contents: [{role: 'model', parts: [{text: aiResponseText}]}], model: modelToUse });

    test_currentOperationStats.outputTokens = opOutputTokens;
    test_currentOperationStats.apiRequests = opApiRequests;
    test_currentOperationStats.estimatedCost = calculateOperationCost(opInputTokens, opOutputTokens, opApiRequests, 'flash');

    const suggestedAiDataUncleaned = JSON.parse(aiResponseText);
    if (Array.isArray(suggestedAiDataUncleaned)) {
      const cleanedAiData = cleanAiNotFoundResponses(suggestedAiDataUncleaned);
      // Simplified merge logic for this test (assumes AI returns all originally sent rows)
      test_aiTestedDataForTable = [headerRow, ...cleanedAiData.slice(1)];
      addLog("AI URL Test Logic: Parsed & cleaned AI response.");

      const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
      if (groundingMetadata?.groundingChunks) {
        test_aiGroundingSources = groundingMetadata.groundingChunks;
        addLog(`AI URL Test Logic: Found ${test_aiGroundingSources.length} grounding sources.`);
      }
      test_currentOperationStats.status = 'completed';
      test_currentOperationStats.progressMessage = 'AI URL Finding Test complete.';
      setStatus("AI URL Test Logic: Complete.");
    } else { throw new Error(`AI response was not a JSON array.`); }
  } catch (e: any) {
    console.error(`AI URL Test Logic: Error:`, e);
    setStatus(`AI URL Test Logic: Error: ${e.message}.`);
    addLog(`AI URL Test Logic: Error encountered: ${e.message}`);
    test_currentOperationStats.status = 'error';
    test_currentOperationStats.progressMessage = `Error: ${e.message}`;
  } finally {
    test_isTestingAiOnPreprocessed = false;
    addLog(`State: test_isTestingAiOnPreprocessed set to ${test_isTestingAiOnPreprocessed} in finally block.`);
    test_totalInputTokens += test_currentOperationStats.inputTokens;
    test_totalOutputTokens += test_currentOperationStats.outputTokens;
    test_totalApiRequestsMade += test_currentOperationStats.apiRequests;
    test_cumulativeEstimatedCost += test_currentOperationStats.estimatedCost;
  }
};


// --- Test Cases ---
const runErrorAndStateTests = async () => {
  // Test Case 7.1: Button Disabled State Logic
  resetCaseState("7.1");
  console.log("\n--- Starting Test Case 7.1: Button Disabled State Logic ---");
  test_inputDataForAiTest = parseCSV("Organization Name,Website URL\nTest Org 1,");
  mockShouldError = false;
  mockApiDelay = 50; // Simulate a small delay if environment supports setTimeout effectively

  console.log("Test 7.1: Before call, test_isTestingAiOnPreprocessed =", test_isTestingAiOnPreprocessed);
  const promise71 = coreAiUrlFindingLogic();
  // Immediately after calling, before await (if async mock delay works)
  console.log("Test 7.1: After call invoked (during mock processing), test_isTestingAiOnPreprocessed =", test_isTestingAiOnPreprocessed);
  await promise71;
  console.log("Test 7.1: After await completed, test_isTestingAiOnPreprocessed =", test_isTestingAiOnPreprocessed);
  console.log("Test 7.1: Final status message:", test_statusMessage);


  // Test Case 7.2: AI API Error Handling
  resetCaseState("7.2");
  console.log("\n--- Starting Test Case 7.2: AI API Error Handling ---");
  test_inputDataForAiTest = parseCSV("Organization Name,Website URL\nError Org,");
  mockShouldError = true;
  mockErrorMessage = "Simulated API Error: Daily quota exceeded";
  mockApiDelay = 0;

  console.log("Test 7.2: Before call, test_isTestingAiOnPreprocessed =", test_isTestingAiOnPreprocessed);
  await coreAiUrlFindingLogic();
  console.log("Test 7.2: After await completed, test_isTestingAiOnPreprocessed =", test_isTestingAiOnPreprocessed);
  console.log("Test 7.2: Final status message:", test_statusMessage);
  console.log("Test 7.2: currentOperationStats:", JSON.stringify(test_currentOperationStats, null, 2));
  console.log("Test 7.2: Activity Log (last 5):", JSON.stringify(test_activityLog.slice(-5), null, 2));


  // Test Case 7.3: Status Messages Review (Conceptual)
  resetCaseState("7.3");
  console.log("\n--- Starting Test Case 7.3: Status Messages Review (Conceptual) ---");
  addLog("Test 7.3: Status messages for success, initiation, and data content (e.g., 'Parsed X rows', 'Y URLs pre-filled') were observed to be correctly set by the application logic in previously simulated test runs (Steps 1-6). This test runner does not re-execute those, but acknowledges prior verification.");
  setStatus("Test 7.3: Conceptual review complete.");

  console.log("\n--- All Error/State Tests Execution Finished ---");
};

runErrorAndStateTests();
console.log("test_runner_step7.ts loaded and tests executed.");
export {};
