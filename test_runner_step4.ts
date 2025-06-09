// test_runner_step4.ts

// --- Simplified State Variables ---
let test_statusMessage: string = '';
let test_activityLog: string[] = [];
let test_displayData: string[][] = []; // Simulates main data table (parsed CSV)
let test_detailedDescriptionTestOutput: string | null = null; // Holds the generated dossier

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
const PRO_PRICE_INPUT_PER_MILLION_TOKENS = 1.25;
const PRO_PRICE_OUTPUT_PER_MILLION_TOKENS = 10.00;

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

const resetTestState = () => {
  test_statusMessage = '';
  test_activityLog = [];
  test_displayData = [];
  test_detailedDescriptionTestOutput = null;
  test_currentOperationStats = { ...initialCurrentOperationStats };
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

const calculateOperationCost = (inputTokens: number, outputTokens: number, apiRequests: number, modelType: 'flash' | 'pro'): number => {
  if (modelType === 'pro') {
    const inputCost = (inputTokens / 1000000) * PRO_PRICE_INPUT_PER_MILLION_TOKENS;
    const outputCost = (outputTokens / 1000000) * PRO_PRICE_OUTPUT_PER_MILLION_TOKENS;
    return inputCost + outputCost;
  }
  // Simplified: Flash model costs not included here as test focuses on Pro for dossier
  return 0;
};

// --- Mocked AI and Token Counting ---
const mockGenAI = {
  models: {
    generateContent: async (params: { model: string, contents: any[], config?: any }) => {
      addLog(`Mock AI (Pro): generateContent called with model ${params.model}.`);
      // Basic verification of received content (optional, can be more detailed)
      const promptText = params.contents[0].parts[0].text;
      if (!promptText.includes("MegaCorp") || !promptText.includes("www.megacorp.com") || !promptText.includes("Existing BL Description for MegaCorp")) {
        addLog("ERROR: Mock AI (Pro) prompt verification failed. Key details missing.");
        console.error("ERROR: Mock AI (Pro) prompt content for MegaCorp:", promptText);
      }

      return Promise.resolve({
        // text: () => `Corporate Intelligence Dossier: MegaCorp\nSection A: ... (full dossier text as per plan)` // To save space, using shorter
        text: () => `Corporate Intelligence Dossier: MegaCorp
Section A: Executive Overview & Strategic Posture
High-Level Summary (c. 200 words): MegaCorp is a leading innovator in synergistic paradigms, utilizing advanced AI.
Mission, Vision, and Stated Values (c. 150 words): To boldly integrate market solutions.
Key Financials & Corporate Structure (c. 150 words): Privately held, 500 employees, HQ in Techville. Tier 3.

Section B: Deep Capability & Operational Analysis
Primary Business Model (c. 200 words): B2B SaaS subscriptions.
Core Products (c. 400 words): SynergyPlatform - AI-driven analytics.
Core Services (c. 400 words): Integration consulting for SynergyPlatform.
Key Underlying Technologies & Processes (c. 300 words): Proprietary ML algorithms.
Target Markets & Ideal Customer Profile (ICP) (c. 250 words): Mid-to-large enterprises in finance.

Section C: Ecosystem, Value Chain, and Network Analysis
Value Chain Roles (Narrative Analysis): OEM and Service Provider.
Known Suppliers & Strategic Technology/Channel Partners (c. 200 words): Partners with CloudProviderX.
Known Customers & Case Studies (c. 250 words): CustomerSuccess Inc achieved 50% efficiency.
Known Competitors (c. 200 words): RivalCorp, OldTech Ltd.

Section D: Strategic & Forward-Looking Analysis
Strategic Direction & Recent News (c. 300 words): Expanding into APAC region.
Key Personnel & Inferred Influence (c. 250 words): CEO John Smith - Strategic Power. CTO Jane Doe - Spec-Driving Power.
[^1]: www.megacorp.com/about`,
        candidates: [] // Dossier generation usually doesn't have grounding chunks like URL finding
      });
    },
    countTokens: async (params: { contents: any[], model: string }): Promise<number> => {
      addLog(`Mock AI (Pro): countTokens called for model ${params.model}.`);
      if (params.contents[0].role === 'user') { // Prompt for dossier
        return Promise.resolve(350);
      } else { // Dossier response
        return Promise.resolve(600);
      }
    }
  }
};

// --- Core Logic for Dossier Generation Test (adapted from index.tsx) ---

// Simplified version of generateDetailedDescriptionForOrganization from index.tsx
const generateDetailedDescriptionForOrganization = async (
    orgName: string, orgUrl: string, existingDesc: string,
    currentOpAccumulators: { input: number; output: number; requests: number; cost: number }, // To be updated by this function
    updateOpStatsCallback: (opTokens: {input: number, output: number, requests: number, cost: number}) => void
  ): Promise<{text: string, opTokens?: {input: number, output: number, requests: number}}> => {
      addLog(`Dossier Gen Sim: Starting for "${orgName}"`);
      const modelToUse = 'gemini-2.5-pro-preview-04-17'; // Hardcoded for this test

      // This is where the very long master prompt would be constructed in the real app.
      // For the test, we just simulate that it's part of the input token count.
      const masterPromptTemplate = `Simulated Master Prompt for ${orgName} at ${orgUrl} with existing desc: ${existingDesc}`;

      let opTokensForCall = { input: 0, output: 0, requests: 0 };

      const promptContent = [{ role: 'user', parts: [{ text: masterPromptTemplate }] }];
      opTokensForCall.input = await mockGenAI.models.countTokens({contents: promptContent, model: modelToUse});

      currentOpAccumulators.input += opTokensForCall.input; // Accumulate for the operation
      let costForThisCallInput = calculateOperationCost(opTokensForCall.input, 0, 1, 'pro');
      updateOpStatsCallback({input: opTokensForCall.input, output: 0, requests: 0, cost: costForThisCallInput});

      addLog(`Dossier Gen Sim for "${orgName}": Sending request to ${modelToUse} (Est. Input Tokens: ${opTokensForCall.input}).`);
      const response = await mockGenAI.models.generateContent({
          model: modelToUse,
          contents: promptContent,
          // config: { tools: [{ googleSearch: {} }] } // Search tool might not be needed if URL is provided
      });
      opTokensForCall.requests = 1;

      if (!response || typeof response.text !== 'function') {
          throw new Error("Invalid or empty response structure from Mock Gemini Pro API.");
      }

      const dossierText = response.text();
      const responseContent = [{ role: 'model', parts: [{ text: dossierText }] }];
      opTokensForCall.output = await mockGenAI.models.countTokens({contents: responseContent, model: modelToUse});

      currentOpAccumulators.output += opTokensForCall.output;
      currentOpAccumulators.requests += opTokensForCall.requests;

      let costForThisCallOutput = calculateOperationCost(0, opTokensForCall.output, 0, 'pro'); // Cost for output only
      updateOpStatsCallback({input:0, output: opTokensForCall.output, requests: opTokensForCall.requests, cost: costForThisCallOutput });

      addLog(`Dossier Gen Sim for "${orgName}": Received response (Est. Output Tokens: ${opTokensForCall.output}).`);
      return { text: dossierText, opTokens: opTokensForCall };
};

// Simplified version of handleTestDescriptionGeneration
const runTestDossierGenerationLogic = async () => {
    addLog("Dossier Generation Test: Initiating.");
    if (test_displayData.length < 2) { // Needs at least one data row + header
        setStatus("Dossier Test: Not enough data loaded in main display."); return;
    }

    const firstDataRow = test_displayData[1]; // Use the first data row
    const orgName = String(firstDataRow[0] ?? '').trim();
    const orgUrl = String(firstDataRow[1] ?? '').trim();
    // Using simplified CSV: OrgName, URL, IgnoredDesc, ActualExistingDesc (index 3)
    const existingDesc = String(firstDataRow[3] ?? '').trim();

    if (!orgName) { setStatus("Dossier Test: First data row has no organization name."); return; }

    addLog(`Dossier Generation Test: Starting for organization: "${orgName}" (URL: ${orgUrl}, Existing Desc from Col63: ${existingDesc})`);
    test_detailedDescriptionTestOutput = null;
    const modelToUse = 'gemini-2.5-pro-preview-04-17';

    // Reset current op stats for this specific operation run
    test_currentOperationStats = {
        operationType: 'test_dossier', status: 'running', inputTokens: 0,
        outputTokens: 0, apiRequests: 0, estimatedCost: 0,
        modelUsed: modelToUse, progressMessage: `Generating dossier for ${orgName}...`
    };
    setStatus(`Dossier Test: Generating for ${orgName}...`);

    let opAccumulator = { input: 0, output: 0, requests: 0, cost: 0 };

    try {
      const { text: dossierText } = await generateDetailedDescriptionForOrganization(
        orgName, orgUrl, existingDesc, opAccumulator,
        (stats) => { // Callback to update test_currentOperationStats incrementally
            test_currentOperationStats.inputTokens += stats.input;
            test_currentOperationStats.outputTokens += stats.output;
            test_currentOperationStats.apiRequests += stats.requests; // Should be 1 for this test
            test_currentOperationStats.estimatedCost += stats.cost;
        }
      );
      test_detailedDescriptionTestOutput = dossierText;
      addLog(`Dossier Test: Successfully generated dossier for "${orgName}".`);
      test_currentOperationStats.status = 'completed';
      test_currentOperationStats.progressMessage = 'Test complete.';
      setStatus("Dossier Generation Test complete.");
    } catch (e: any) {
      addLog(`Dossier Test Error for "${orgName}": ${e.message}`);
      setStatus(`Dossier Test Error: ${e.message}`);
      test_detailedDescriptionTestOutput = `Error generating dossier: ${e.message}`;
      test_currentOperationStats.status = 'error';
      test_currentOperationStats.progressMessage = `Error: ${e.message}`;
    } finally {
      // Update cumulative totals from the final state of test_currentOperationStats for this op
      test_totalInputTokens += test_currentOperationStats.inputTokens;
      test_totalOutputTokens += test_currentOperationStats.outputTokens;
      test_totalApiRequestsMade += test_currentOperationStats.apiRequests;
      test_cumulativeEstimatedCost += test_currentOperationStats.estimatedCost;
    }
};

// --- Main Test Execution ---
let mockTestFiles: { [key: string]: string } = {};

const runMainDossierTest = async () => {
  resetTestState();

  const orgForDossierCsv = mockTestFiles["org_for_dossier_test.csv"];
  if (!orgForDossierCsv) {
    setStatus("Error: org_for_dossier_test.csv not found in mockTestFiles.");
    return;
  }
  test_displayData = parseCSV(orgForDossierCsv); // Populate displayData
  addLog(`Loaded ${test_displayData.length} rows from org_for_dossier_test.csv into displayData.`);

  await runTestDossierGenerationLogic();

  // --- Verification ---
  console.log("\n--- VERIFICATION ---");
  console.log("Final detailedDescriptionTestOutput:\n", test_detailedDescriptionTestOutput);
  console.log("Final currentOperationStats:", JSON.stringify(test_currentOperationStats, null, 2));
  console.log("Final cumulativeEstimatedCost:", test_cumulativeEstimatedCost.toFixed(6)); // Increased precision for pro model costs
  console.log("Final totalInputTokens:", test_totalInputTokens);
  console.log("Final totalOutputTokens:", test_totalOutputTokens);
  console.log("Final totalApiRequestsMade:", test_totalApiRequestsMade);
  console.log("Final Status Message:", test_statusMessage);
  console.log("Final Activity Log (last 10 entries):", JSON.stringify(test_activityLog.slice(-10), null, 2));
  console.log("--- VERIFICATION END ---");
};

mockTestFiles = {
  "org_for_dossier_test.csv": `Organization Name,Website URL,Description (Ignored),Actual Existing Description
MegaCorp,www.megacorp.com,Technology,Existing BL Description for MegaCorp
SecondOrg,www.second.com,Services,Existing BL for SecondOrg`
};

runMainDossierTest();

console.log("test_runner_step4.ts loaded and test executed.");
export {};
