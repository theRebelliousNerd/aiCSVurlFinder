// test_runner_step6.ts

// --- Simplified State Variables ---
let test_activityLog: string[] = [];
let test_statusMessage: string = '';

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
  test_activityLog = [];
  test_statusMessage = '';
  addLog("--- Test State Reset ---");
};

// --- stringifyCSV Function (copied from index.tsx) ---
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

// --- Simulated Download Logic ---

// Simulates parts of handleDownloadCsv from index.tsx
const simulateMainDownload = (displayData: string[][], currentFileName: string) => {
  addLog("Download initiated (main data).");
  if (!displayData || displayData.length === 0) {
    setStatus('No main data to download.');
    return { csvString: '', effectiveFileName: currentFileName, success: false };
  }
  try {
    const csvString = stringifyCSV(displayData);
    // In the real app, a blob is created and link is clicked. Here we just check the string and name.
    setStatus(`CSV download started as ${currentFileName}.`);
    addLog(`Simulated main data CSV content:\n${csvString}`);
    return { csvString, effectiveFileName: currentFileName, success: true };
  } catch (err: any) {
    setStatus(`Error preparing main data CSV: ${err.message}`);
    return { csvString: '', effectiveFileName: currentFileName, success: false };
  }
};

// Simulates parts of handleDownloadCorrectedContactsCsv from index.tsx
const simulateContactsDownload = (contactsData: string[][] | null, originalLoadedFileName: string) => {
  addLog("Corrected Contacts CSV Download initiated.");
  if (!contactsData || contactsData.length === 0) {
    setStatus('No corrected contacts data to download.');
    return { csvString: '', effectiveFileName: '', success: false };
  }
  try {
    const csvString = stringifyCSV(contactsData);
    const baseFileName = originalLoadedFileName.replace('_with_urls.csv', '').replace(/\.(csv|xlsx|xls)$/i, '');
    const contactsFileName = `${baseFileName}_corrected_contacts.csv`;
    setStatus(`Corrected Contacts CSV download started as ${contactsFileName}.`);
    addLog(`Simulated contacts data CSV content:\n${csvString}`);
    return { csvString, effectiveFileName: contactsFileName, success: true };
  } catch (err: any) {
    setStatus(`Error preparing Corrected Contacts CSV: ${err.message}`);
    return { csvString: '', effectiveFileName: '', success: false };
  }
};


// --- Test Cases & Verification ---

const runDownloadTests = () => {
  resetTestState();
  console.log("--- Starting Test Case 6.1: stringifyCSV - Main Data Download Simulation ---");
  const test_main_data: string[][] = [
    ["Organization Name", "Website URL", "Industry", "Notes"],
    ["Org A", "orga.com", "Tech", "A sample note"],
    ["Org B", "orgb.com", "Finance", "Contains, a comma"],
    ["Org C", "orgc.com", "Healthcare", "Line 1\nLine 2"],
    ["Org D", "orgd.com", "Services", "Has \"quotes\""],
    ["Org E", null as any, "Manufacturing", undefined as any] // Using 'as any' to satisfy string[][] for test data
  ];
  const test_fileName_main = "edited_data_with_urls.csv";
  const expected_csv_main =
`Organization Name,Website URL,Industry,Notes
Org A,orga.com,Tech,A sample note
Org B,orgb.com,Finance,"Contains, a comma"
Org C,orgc.com,Healthcare,"Line 1\nLine 2"
Org D,orgd.com,Services,"Has ""quotes"""
Org E,,Manufacturing,`;

  const mainDownloadResult = simulateMainDownload(test_main_data, test_fileName_main);
  console.log("Test 6.1: stringifyCSV output for main data matches expected:", mainDownloadResult.csvString === expected_csv_main);
  if (mainDownloadResult.csvString !== expected_csv_main) {
    console.error("Test 6.1 Expected Main CSV:\n", expected_csv_main);
    console.error("Test 6.1 Actual Main CSV:\n", mainDownloadResult.csvString);
  }
  console.log("Test 6.1: Effective main filename matches expected:", mainDownloadResult.effectiveFileName === test_fileName_main);
  console.log("Test 6.1: Activity Log (last 3):", JSON.stringify(test_activityLog.slice(-3), null, 2));


  resetTestState();
  console.log("\n--- Starting Test Case 6.2: stringifyCSV - Corrected Contacts Download Simulation ---");
  const test_contacts_data: string[][] = [
    ["FirstName", "LastName", "Email", "Accounts::::ORG_NAME"],
    ["John", "Doe", "john@doe.com", "Accounts::::Org A"],
    ["Jane", "Smith", "jane@smith.com", "Accounts::::Org B, Sub Unit"]
  ];
  const test_fileName_original = "my_uploaded_data.xlsx";
  const expected_csv_contacts =
`FirstName,LastName,Email,Accounts::::ORG_NAME
John,Doe,john@doe.com,Accounts::::Org A
Jane,Smith,jane@smith.com,"Accounts::::Org B, Sub Unit"`;
  const expected_contacts_download_filename = "my_uploaded_data_corrected_contacts.csv";

  const contactsDownloadResult = simulateContactsDownload(test_contacts_data, test_fileName_original);
  console.log("Test 6.2: stringifyCSV output for contacts data matches expected:", contactsDownloadResult.csvString === expected_csv_contacts);
   if (contactsDownloadResult.csvString !== expected_csv_contacts) {
    console.error("Test 6.2 Expected Contacts CSV:\n", expected_csv_contacts);
    console.error("Test 6.2 Actual Contacts CSV:\n", contactsDownloadResult.csvString);
  }
  console.log("Test 6.2: Effective contacts filename matches expected:", contactsDownloadResult.effectiveFileName === expected_contacts_download_filename);
  console.log("Test 6.2: Activity Log (last 3):", JSON.stringify(test_activityLog.slice(-3), null, 2));


  resetTestState();
  console.log("\n--- Starting Test Case 6.3: stringifyCSV - Edge Cases ---");

  // Sub-case: Empty Array
  const emptyArrayInput: string[][] = [];
  const expected_empty_array_csv = ""; // stringifyCSV returns "" for empty array input.
  let result_csv = stringifyCSV(emptyArrayInput);
  console.log("Test 6.3.1 (Empty Array): Input [], Output === \"\":", result_csv === expected_empty_array_csv);
  if(result_csv !== expected_empty_array_csv) console.error(`Expected: "${expected_empty_array_csv}", Got: "${result_csv}"`);

  // Sub-case: Array with only headers
  const onlyHeadersInput: string[][] = [["Header1", "Header2", "Header3"]];
  const expected_only_headers_csv = "Header1,Header2,Header3";
  result_csv = stringifyCSV(onlyHeadersInput);
  console.log("Test 6.3.2 (Only Headers): Output matches expected:", result_csv === expected_only_headers_csv);
  if(result_csv !== expected_only_headers_csv) console.error(`Expected: "${expected_only_headers_csv}", Got: "${result_csv}"`);

  // Sub-case: Array with null/undefined cells
  const nullUndefinedInput: string[][] = [["ColA", "ColB"], [null as any, "Val1"], ["Val2", undefined as any]];
  const expected_null_undefined_csv = "ColA,ColB\n,Val1\nVal2,";
  result_csv = stringifyCSV(nullUndefinedInput);
  console.log("Test 6.3.3 (Null/Undefined): Output matches expected:", result_csv === expected_null_undefined_csv);
  if(result_csv !== expected_null_undefined_csv) console.error(`Expected: "${expected_null_undefined_csv}", Got: "${result_csv}"`);

  // Sub-case: Array with empty row (empty inner array)
  // Note: The original stringifyCSV would map an empty array `[]` within `data` to an empty string, which then becomes a line with just a newline if it's the only 'cell'.
  // If `row.map` receives an empty array, it produces an empty array. `join(',')` on `[]` is `""`.
  // So `[["H1"], [], ["V1"]]` -> "H1\n\nV1" (empty string field from the empty row, then join by \n)
  const emptyRowInput: string[][] = [["H1"], [], ["V1"]];
  const expected_empty_row_csv = "H1\n\nV1";
  result_csv = stringifyCSV(emptyRowInput);
  console.log("Test 6.3.4 (Empty Row): Output matches expected:", result_csv === expected_empty_row_csv);
  if(result_csv !== expected_empty_row_csv) console.error(`Expected: "${expected_empty_row_csv}", Got: "${result_csv}"`);

  console.log("\n--- All Download Tests Execution Finished ---");
};

runDownloadTests();
console.log("test_runner_step6.ts loaded and tests executed.");
export {};
