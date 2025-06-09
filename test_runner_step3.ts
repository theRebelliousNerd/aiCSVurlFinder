// test_runner_step3.ts

// --- Simplified State Variables ---
let test_statusMessage: string = '';
let test_activityLog: string[] = [];
let test_aiTestedDataForTable: string[][] | null = null; // Holds result of AI URL finding
let test_aiGroundingSources: any[] = [];

// Represents the data that would be the input for the AI test
// (e.g., equivalent to mergedTestDataForTable or similar from App state)
let test_inputDataForAiTest: string[][] | null = null;

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

// Cumulative session stats
let test_totalInputTokens: number = 0;
let test_totalOutputTokens: number = 0;
let test_totalApiRequestsMade: number = 0;
let test_cumulativeEstimatedCost: number = 0;


// --- Constants ---
const FLASH_PRICE_INPUT_PER_MILLION_TOKENS = 0.15;
const FLASH_PRICE_OUTPUT_THINKING_PER_MILLION_TOKENS = 3.50;
const GENERIC_EMAIL_DOMAINS = [ // Simplified, ensure it's consistent if isPlausibleUrl uses it
  'gmail.com', 'yahoo.com', 'outlook.com', 'aol.com', 'hotmail.com',
].map(d => d.toLowerCase());


// --- Logging and State Update Functions ---
const addLog = (message: string) => {
  const logEntry = `[${new Date().toLocaleTimeString()}] ${message}`;
  test_activityLog.push(logEntry);
  console.log(`LOG: ${logEntry}`);
};

const setStatus = (message: string) => {
  test_statusMessage = message;
  addLog(message); // Status messages are usually logged
  console.log(`STATUS: ${test_statusMessage}`);
};

const resetTestState = () => {
  test_statusMessage = '';
  test_activityLog = [];
  test_aiTestedDataForTable = null;
  test_aiGroundingSources = [];
  test_inputDataForAiTest = null;
  test_currentOperationStats = { ...initialCurrentOperationStats };
  // Reset cumulative for isolated test runs if desired, or manage externally
  // For this test, we'll assume they start at 0 or a defined baseline if chaining.
  // Let's reset them for this specific test focuses on one operation:
  test_totalInputTokens = 0;
  test_totalOutputTokens = 0;
  test_totalApiRequestsMade = 0;
  test_cumulativeEstimatedCost = 0;
  addLog("--- Test State Reset ---");
};

// --- Helper Functions (copied/adapted) ---
const parseCSV = (csvText: string): string[][] => {
  const lines = csvText.split('\n').filter(line => String(line ?? '').trim() !== '');
  return lines.map(line => {
    const values: string[] = [];
    let currentField = ''; let inQuotes = false;
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
  if (trimmedUrl === '') return false;
  if (!trimmedUrl.includes('.')) return false;
  if (trimmedUrl.includes('@') && GENERIC_EMAIL_DOMAINS.some(domain => trimmedUrl.endsWith(domain))) return false;
  if (GENERIC_EMAIL_DOMAINS.some(domain => normalizeUrlForComparison(trimmedUrl) === domain)) return false;
  return true;
};

const cleanAiNotFoundResponses = (data: string[][]): string[][] => {
  if (!data || data.length === 0) return data;
  const notFoundPlaceholders = ["url_not_found", "no official website found", "not found", "n/a", "null", "undefined"]
    .map(p => p.toLowerCase());
  const cleanedData = data.map(row => row.map(cell => String(cell ?? '')));
  for (let i = 1; i < cleanedData.length; i++) {
    const row = cleanedData[i];
    if (row.length > 2) { // Assuming URL is typically in column C (index 2)
      const cellValue = String(row[1] ?? ''); // Check URL column (index 1 based on test CSV)
      if (cellValue.trim() !== '' && notFoundPlaceholders.includes(cellValue.trim().toLowerCase())) {
        row[1] = "";
      }
    }
  }
  return cleanedData;
};

const calculateOperationCost = (inputTokens: number, outputTokens: number, apiRequests: number, modelType: 'flash' | 'pro'): number => {
  // Simplified cost calculation for Flash model as per test plan
  if (modelType === 'flash') {
    const inputCost = (inputTokens / 1000000) * FLASH_PRICE_INPUT_PER_MILLION_TOKENS;
    const outputCost = (outputTokens / 1000000) * FLASH_PRICE_OUTPUT_THINKING_PER_MILLION_TOKENS;
    // Grounding cost is more complex (daily free tier), simplified here as per request for operation cost
    return inputCost + outputCost;
  }
  return 0; // Other models not in scope for this test's cost calculation
};


// --- Mocked AI and Token Counting ---
const mockGenAI = {
  models: {
    generateContent: async (params: { model: string, contents: any[], config?: any }) => {
      addLog(`Mock AI: generateContent called with model ${params.model}.`);
      // Log the actual data sent to AI for verification
      console.log("Mock AI: Prompt content received:", JSON.stringify(params.contents[0].parts[0].text));

      // Verify that only rows needing URLs are in the prompt
      const promptText = params.contents[0].parts[0].text;
      if (!promptText.includes("TechNova Solutions") ||
          promptText.includes("Global Imports Inc") || // Should NOT be in prompt as it has a URL
          !promptText.includes("NonExistent Corp") ||
          !promptText.includes("Famous Charity Org") ||
          promptText.includes("AlreadyFound LLC") // Should NOT be in prompt
          ) {
            addLog("ERROR: Mock AI prompt verification failed. Prompt does not contain the correct rows.");
            console.error("ERROR: Mock AI prompt verification failed. Prompt:", promptText);
          }


      return Promise.resolve({
        text: () => JSON.stringify([ // This is response.text()
          ["Organization Name","Website URL","Industry","Description"],
          ["TechNova Solutions","technova.com","Software","Innovative software development"],
          ["NonExistent Corp","","Services","A company that doesn't exist"],
          ["Famous Charity Org","famouscharity.org","Non-Profit","Well-known charitable organization"]
        ]),
        candidates: [{
          groundingMetadata: {
            groundingChunks: [
              { web: { uri: 'https://source.example.com/technova', title: 'TechNova Info' } },
              { web: { uri: 'https://source.example.com/charity', title: 'Famous Charity Site' } }
            ]
          }
        }]
      });
    },
    countTokens: async (params: { contents: any[], model: string }): Promise<number> => {
      addLog(`Mock AI: countTokens called for model ${params.model}.`);
      // Based on role (user for prompt, model for response) or content analysis if more complex
      if (params.contents[0].role === 'user') { // Assuming prompt
        return Promise.resolve(150);
      } else { // Assuming response
        return Promise.resolve(100);
      }
    }
  }
};


// --- Core Logic for AI URL Finding Test (adapted from handleAiTestOnPreprocessedData) ---
const runAiUrlFindingTestLogic = async () => {
  addLog("AI URL Finding Test: Initiating.");
  if (!test_inputDataForAiTest || test_inputDataForAiTest.length < 2) {
    setStatus("AI URL Finding Test: No input data loaded (mergedTestDataForTable equivalent).");
    return;
  }

  const modelToUse = 'gemini-2.5-flash-preview-04-17';
  test_currentOperationStats = {
    operationType: 'test_url', status: 'running', inputTokens: 0,
    outputTokens: 0, apiRequests: 0, estimatedCost: 0,
    modelUsed: modelToUse, progressMessage: `Processing ${test_inputDataForAiTest.length -1} rows...`
  };
  setStatus(`AI URL Test: Processing sample with AI...`);
  test_aiGroundingSources = [];

  // Logic to select only rows needing URLs (from handleFindUrlsWithAi)
  const headerRow = test_inputDataForAiTest[0];
  const dataRowsForAISubmission = test_inputDataForAiTest.slice(1).filter(row => !isPlausibleUrl(String(row[1] ?? '')));

  if (dataRowsForAISubmission.length === 0) {
    addLog("AI URL Test: No rows require URL lookup. Skipping AI call.");
    test_aiTestedDataForTable = [...test_inputDataForAiTest]; // All rows already have URLs
    test_currentOperationStats.status = 'completed';
    test_currentOperationStats.progressMessage = 'No rows needed AI processing.';
    setStatus("AI URL Test: Completed. No rows needed AI processing.");
    return;
  }
  addLog(`AI URL Test: Sending ${dataRowsForAISubmission.length} rows to AI for URL lookup.`);

  const dataToSendToAI = [headerRow, ...dataRowsForAISubmission];
  const dataToSendToAiString = JSON.stringify(dataToSendToAI); // For prompt construction
  const testPrompt = `For the provided JSON array of CSV data (first row is headers): <data>${dataToSendToAiString}</data> Task: 1. For each data row (skip header): a. Organization Name is in Column A (index 0). b. Using Google Search to find the official website URL. Prioritize known businesses. c. If URL found, put main domain (e.g., "company.com") in Column C. Ensure Column C header is "Website URL". If Column C doesn't exist, add it with this header. d. If no URL or not a business, ensure Column C is an empty string. e. Preserve all other data. 2. Output the *entire modified data* (header + data rows) as a JSON array of arrays. All cell values must be strings.`;

  let response: any;
  let opInputTokens = 0; let opOutputTokens = 0; let opApiRequests = 0;

  try {
    const promptTokenContents = [{role: 'user', parts: [{text: testPrompt}]}];
    opInputTokens = await mockGenAI.models.countTokens({ contents: promptTokenContents, model: modelToUse });
    test_currentOperationStats.inputTokens = opInputTokens;
    test_currentOperationStats.estimatedCost = calculateOperationCost(opInputTokens, 0, 1, 'flash');

    response = await mockGenAI.models.generateContent({ model: modelToUse, contents: promptTokenContents, config: { tools: [{googleSearch: {}}] } });
    opApiRequests = 1;

    if (!response || typeof response.text !== 'function') {
      addLog("AI URL Test: API call completed but response or response.text is invalid/missing.");
      throw new Error("Invalid/empty AI response structure from Mock Gemini API.");
    }

    const aiResponseText = response.text(); // Call the function to get the string
    const responseTokenContents = [{role: 'model', parts: [{text: aiResponseText}]}];
    opOutputTokens = await mockGenAI.models.countTokens({ contents: responseTokenContents, model: modelToUse });

    test_currentOperationStats.outputTokens = opOutputTokens;
    test_currentOperationStats.apiRequests = opApiRequests;
    test_currentOperationStats.estimatedCost = calculateOperationCost(opInputTokens, opOutputTokens, opApiRequests, 'flash');
    addLog(`AI URL Test: Processing AI response (Output Tokens: ${opOutputTokens}).`);

    // No markdown fences in this mock, directly parse
    const suggestedAiDataUncleaned = JSON.parse(aiResponseText);
    if (Array.isArray(suggestedAiDataUncleaned)) {
      const cleanedAiData = cleanAiNotFoundResponses(suggestedAiDataUncleaned);
      addLog("AI URL Test: Parsed & cleaned AI response.");

      // Merge AI results with original data that didn't need lookup
      const aiProcessedRowsOnly = cleanedAiData.slice(1); // AI only returns rows it processed
      let resultData = [headerRow];
      let aiDataIdx = 0;
      for (let i = 1; i < test_inputDataForAiTest.length; i++) {
          const originalRow = test_inputDataForAiTest[i];
          if (!isPlausibleUrl(String(originalRow[1] ?? ''))) { // If this row was sent to AI
              if (aiDataIdx < aiProcessedRowsOnly.length &&
                  String(originalRow[0] ?? '').toLowerCase() === String(aiProcessedRowsOnly[aiDataIdx][0] ?? '').toLowerCase()) {
                  resultData.push(aiProcessedRowsOnly[aiDataIdx]);
                  aiDataIdx++;
              } else {
                  addLog(`ERROR: AI response mismatch for original row: ${originalRow[0]}. Using original.`);
                  resultData.push(originalRow); // Fallback if mismatch
              }
          } else { // This row was not sent to AI, keep original
              resultData.push(originalRow);
          }
      }
      test_aiTestedDataForTable = resultData;

      const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
      if (groundingMetadata?.groundingChunks) {
        const webChunks = groundingMetadata.groundingChunks.filter((c:any) => c.web && c.web.uri);
        test_aiGroundingSources = webChunks;
        addLog(`AI URL Test: Found ${webChunks.length} valid grounding sources.`);
      } else { addLog("AI URL Test: No web grounding sources found in AI response."); }
      test_currentOperationStats.status = 'completed';
      test_currentOperationStats.progressMessage = 'AI URL Finding Test complete.';
      setStatus("AI URL Finding Test complete.");
    } else {
      throw new Error(`AI URL Test: AI response was not a JSON array.`);
    }
  } catch (e: any) {
    console.error(`AI URL Test: Error:`, e);
    setStatus(`AI URL Finding Test: Error: ${e.message}.`);
    addLog(`AI URL Finding Test: Error encountered: ${e.message}`);
    test_currentOperationStats.status = 'error';
    test_currentOperationStats.progressMessage = `Error: ${e.message}`;
  } finally {
    test_totalInputTokens += test_currentOperationStats.inputTokens;
    test_totalOutputTokens += test_currentOperationStats.outputTokens;
    test_totalApiRequestsMade += test_currentOperationStats.apiRequests;
    test_cumulativeEstimatedCost += test_currentOperationStats.estimatedCost;
    // Recalculate cumulative not needed here as it's handled by accumulation directly.
  }
};


// --- Main Test Execution ---
let mockTestFiles: { [key: string]: string } = {};

const runMainTest = async () => {
  resetTestState();

  // Load data for the test
  const orgsForAiTestCsv = mockTestFiles["orgs_for_ai_url_test.csv"];
  if (!orgsForAiTestCsv) {
    setStatus("Error: orgs_for_ai_url_test.csv not found in mockTestFiles.");
    return;
  }
  test_inputDataForAiTest = parseCSV(orgsForAiTestCsv);
  addLog(`Loaded ${test_inputDataForAiTest.length} rows from orgs_for_ai_url_test.csv to simulate 'mergedTestDataForTable'.`);

  // Run the AI URL finding test logic
  await runAiUrlFindingTestLogic();

  // --- Verification ---
  console.log("\n--- VERIFICATION ---");
  console.log("Final aiTestedDataForTable:", JSON.stringify(test_aiTestedDataForTable, null, 2));
  console.log("Final aiGroundingSources:", JSON.stringify(test_aiGroundingSources, null, 2));
  console.log("Final currentOperationStats:", JSON.stringify(test_currentOperationStats, null, 2));
  console.log("Final cumulativeEstimatedCost:", test_cumulativeEstimatedCost.toFixed(4));
  console.log("Final totalInputTokens:", test_totalInputTokens);
  console.log("Final totalOutputTokens:", test_totalOutputTokens);
  console.log("Final totalApiRequestsMade:", test_totalApiRequestsMade);
  console.log("Final Status Message:", test_statusMessage);
  console.log("Final Activity Log (last 15 entries):", JSON.stringify(test_activityLog.slice(-15), null, 2));
  console.log("--- VERIFICATION END ---");
};


// Populate mockTestFiles and run
mockTestFiles = {
  "orgs_for_ai_url_test.csv": `Organization Name,Website URL,Industry,Description
TechNova Solutions,,Software,Innovative software development
Global Imports Inc,www.globalimports.com,Retail,Imports general goods
NonExistent Corp,,Services,A company that doesn't exist
Famous Charity Org,,Non-Profit,Well-known charitable organization
AlreadyFound LLC,alreadyfound.com,Consulting,This one is already found`
};

runMainTest();

console.log("test_runner_step3.ts loaded and test executed.");
export {};
