// test_runner.ts

// --- Global State Variables (simplified) ---
let test_statusMessage: string = '';
let test_activityLog: string[] = [];
let test_displayData: string[][] = [];
let test_rawContactsSheetData: string[][] | null = null;
let test_displayableCorrectedContactsData: string[][] | null = null;
let test_originalContactsSampleForCorrectionTestDisplay: string[][] | null = null;

const TEST_DATA_ROW_COUNT = 100; // From index.tsx

const addLog = (message: string) => {
  test_activityLog.push(`[${new Date().toLocaleTimeString()}] ${message}`);
  console.log(`LOG: ${message}`);
};

const updateDisplayData = (data: string[][], source: string, message?: string) => {
  test_displayData = data;
  if (message) {
    test_statusMessage = message;
    addLog(message);
  } else {
    test_statusMessage = `${source} data loaded.`;
    addLog(test_statusMessage);
  }
  // In the real app, this also updates a JSON string for display. We'll skip that part.
  console.log("DISPLAY_DATA_UPDATED:", test_displayData);
  console.log("STATUS_MSG:", test_statusMessage);
};

const resetTestState = () => {
    test_statusMessage = '';
    test_activityLog = [];
    test_displayData = [];
    test_rawContactsSheetData = null;
    test_displayableCorrectedContactsData = null;
    test_originalContactsSampleForCorrectionTestDisplay = null;
    addLog("Test state reset.");
};

// --- Constants (from index.tsx) ---
const GENERIC_EMAIL_DOMAINS = [
  'gmail.com', 'yahoo.com', 'outlook.com', 'aol.com', 'hotmail.com',
  'icloud.com', 'live.com', 'msn.com', 'protonmail.com', 'zoho.com',
  'gmx.com', 'mail.com', 'yandex.com', 'comcast.net', 'verizon.net',
  'att.net', 'sbcglobal.net', 'bellsouth.net', 'cox.net', 'charter.net',
].map(d => d.toLowerCase());

// --- Helper Functions (copied or adapted from index.tsx) ---
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

const extractDomainFromEmail = (email: string): string | null => {
    if (!email || typeof email !== 'string') return null;
    const atIndex = email.lastIndexOf('@');
    if (atIndex === -1 || atIndex === email.length - 1) return null;
    return email.substring(atIndex + 1).toLowerCase();
};

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

const isPlausibleUrl = (url: string): boolean => {
  const trimmedUrl = String(url ?? '').trim();
  if (trimmedUrl === '') return false;
  if (!trimmedUrl.includes('.')) return false;
  if (trimmedUrl.includes('@') && GENERIC_EMAIL_DOMAINS.some(domain => trimmedUrl.endsWith(domain))) return false;
  if (GENERIC_EMAIL_DOMAINS.some(domain => normalizeUrlForComparison(trimmedUrl) === domain)) return false;
  return true;
};

const correctContactSheetAccountAssignments = (originalContactsData: string[][]): string[][] => {
    addLog("Starting Contact Sheet Account Correction process.");
    if (!originalContactsData || originalContactsData.length < 2) {
        addLog("Contact sheet is empty or has no data rows. Skipping correction.");
        return originalContactsData.map(row => row.map(cell => String(cell ?? '')));
    }

    const domainToOrgNameMap = new Map<string, string>();
    // Assuming header format: FirstName,LastName,Email,Title,Accounts::::ORG_NAME
    // Email is at index 2, Account is at index 4 in 0-indexed array if header is split
    // From index.tsx: email = contactRow[3], accountCell = contactRow[9]
    // This implies the CSV parser or Excel parser results in more columns than explicitly defined
    // Let's stick to the indices used in the provided `index.tsx` code, assuming some columns before/between.
    // For this test runner, we'll assume direct CSV parsing where:
    // Email index = 2 (0:FirstName, 1:LastName, 2:Email)
    // Account Name index = 4 (0:FirstName, 1:LastName, 2:Email, 3:Title, 4:Accounts::::ORG_NAME)
    // This needs to be consistent with how `test_excel_Contacts.csv` is structured.
    // test_excel_Contacts.csv: FirstName,LastName,Email,Title,Accounts::::ORG_NAME
    // So, Email index 2, Accounts::::ORG_NAME index 4.

    const contactsHeader = originalContactsData[0].map(cell => String(cell ?? ''));
    const contactsBody = originalContactsData.slice(1).map(row => row.map(cell => String(cell ?? '')));
    let correctionsMade = 0;

    addLog("Contact Correction - Pass 1: Building domain-to-organization map.");
    contactsBody.forEach((contactRow) => {
        const email = String(contactRow[2] ?? '').trim(); // Email
        const accountCell = String(contactRow[4] ?? '').trim(); // Accounts::::ORG_NAME

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
        const email = String(contactRowToCorrect[2] ?? '').trim(); // Email
        if (email) {
            const domain = extractDomainFromEmail(email);
            if (domain && domainToOrgNameMap.has(domain)) {
                const correctOrgName = domainToOrgNameMap.get(domain)!;
                const expectedAccountCellValue = "Accounts::::" + correctOrgName;

                // Ensure row has enough columns, pad if necessary
                while (contactRowToCorrect.length < 5) contactRowToCorrect.push('');
                const currentAccountCell = String(contactRowToCorrect[4] ?? '').trim(); // Accounts::::ORG_NAME

                if (currentAccountCell.toLowerCase() !== expectedAccountCellValue.toLowerCase()) {
                    const oldValue = contactRowToCorrect[4] || '';
                    contactRowToCorrect[4] = expectedAccountCellValue;
                    const contactName = `${String(contactRowToCorrect[0] ?? '').trim()} ${String(contactRowToCorrect[1] ?? '').trim()}`.trim() || `contact at row ${index + 2}`;
                    addLog(`Contact Correction: Updated account for ${contactName} (email: ${email}) from '${oldValue}' to '${expectedAccountCellValue}'.`);
                    correctionsMade++;
                }
            }
        }
    });

    addLog(`Contact Sheet Account Correction process complete. ${correctionsMade} corrections applied.`);
    return [contactsHeader, ...correctedContactsBody];
  };

const prefillUrlsFromContacts = (orgsData: string[][], contactsData: string[][]): { updatedOrgsData: string[][], prefilledCount: number } => {
    addLog("Starting URL pre-fill process from contacts sheet.");
    let prefilledCount = 0;
    // Make a deep copy to avoid modifying the original data directly
    const updatedOrgsData = orgsData.map(orgRow => orgRow.map(cell => String(cell ?? '')));

    // Ensure "Website URL" header exists in organizations sheet (assumed to be index 1 for this test runner)
    // Original code: orgRow[2] for URL. test_excel_Organizations.csv: Name,Website URL,Notes. So URL is index 1.
    if (updatedOrgsData.length > 0) {
        const header = updatedOrgsData[0];
        while (header.length < 2) header.push(''); // Ensure at least Name and URL columns
        if (String(header[1] ?? '').trim() === '') { // URL column
            header[1] = "Website URL";
            addLog("Added 'Website URL' header to column B of organizations sheet for pre-fill.");
        }
    }

    for (let i = 1; i < updatedOrgsData.length; i++) {
        const orgRow = updatedOrgsData[i];
        const orgName = String(orgRow[0] ?? '').trim().toLowerCase(); // Org Name at index 0
        if (!orgName) continue;

        while (orgRow.length < 2) orgRow.push(''); // Ensure URL column exists for data rows

        // URL is at index 1
        if (isPlausibleUrl(String(orgRow[1] ?? ''))) {
             const existingUrlDomain = normalizeUrlForComparison(String(orgRow[1] ?? ''));
             if (existingUrlDomain && !GENERIC_EMAIL_DOMAINS.some(genDomain => existingUrlDomain.endsWith(genDomain))) {
                 addLog(`Skipping pre-fill for "${orgRow[0]}" as plausible non-generic URL already exists: "${orgRow[1]}"`);
                 continue;
            }
        }
        // Contact sheet: Email at index 2, Account Name at index 4
        for (const contactRow of contactsData.slice(1)) {
            const accountCell = String(contactRow[4] ?? '').trim(); // Accounts::::ORG_NAME
            if (accountCell && accountCell.toLowerCase().startsWith("accounts::::")) {
                const contactOrgName = accountCell.substring("accounts::::".length).trim().toLowerCase();
                if (contactOrgName === orgName) {
                    const email = String(contactRow[2] ?? '').trim(); // Email
                    if (email) {
                        const domain = extractDomainFromEmail(email);
                        if (domain) {
                            if (GENERIC_EMAIL_DOMAINS.includes(domain)) {
                                addLog(`Skipped pre-filling URL for "${orgRow[0]}" from contact email "${email}" because domain "${domain}" is generic.`);
                            } else {
                                orgRow[1] = domain; // Update URL at index 1
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
  };

// --- Mocked File Data ---
const mockFileContents: { [key: string]: string } = {
  "test_orgs.csv": `Organization Name,Industry,Country
OrgA,Tech,USA
OrgB,Finance,UK
OrgC,Healthcare,Canada`,
  "test_excel_Organizations.csv": `Organization Name,Website URL,Notes
Alpha Corp,,Needs URL
Beta Ltd,www.betaalready.com,Existing URL
Gamma Inc,,To be pre-filled
Delta Solutions,,Generic email contact
Epsilon Services,www.epsilon.org,Keep this`,
  "test_excel_Contacts.csv": `FirstName,LastName,Email,Title,Accounts::::ORG_NAME
John,Doe,john.doe@alphadomain.com,Manager,Accounts::::Alpha Corp
Jane,Smith,jane.smith@betaalready.com,Analyst,Accounts::::Beta Ltd
Alice,Brown,alice@gammadomain.net,Director,Accounts::::Gamma Inc
Bob,Green,bob.green@gmail.com,Specialist,Accounts::::Delta Solutions
Carol,White,carol@epsilon.org,CEO,Accounts::::Epsilon Services
David,Black,david.black@another.org,VP,Accounts::::Zeta Co
Eve,Blue,eve.blue@gammadomain.net,Rep,Accounts::::Gamma Inc`,
  "unsupported.txt": "This is a text file, not a CSV or Excel.",
  "empty.csv": ""
};

// --- Simplified handleFileChange ---
// For Excel, we'll simulate by directly providing the parsed sheets
// as if XLSX.read and XLSX.utils.sheet_to_json had been called.
const simplifiedHandleFileChange = async (fileName: string, fileContent: string, contactsContent?: string | undefined) => {
    resetTestState(); // Reset state for each test case
    addLog(`File selected: ${fileName}`);
    const fileExtension: string = fileName.toLowerCase().split('.').pop() ?? '';

    if (!['csv', 'xlsx', 'xls'].includes(fileExtension)) {
        test_statusMessage = 'Invalid file type.';
        addLog(`Invalid file: ${fileName}.`);
        // In a real scenario, displayData would remain unchanged.
        // Here, it's reset by resetTestState, which is fine for isolated tests.
        return;
    }

    let localOrganizationSheetData: string[][];
    let localContactsSheetDataForProcessing: string[][] | null = null;

    try {
        if (fileExtension === 'csv') {
            addLog('Parsing CSV...');
            localOrganizationSheetData = parseCSV(fileContent).map(row => row.map(cell => String(cell ?? '')));
        } else { // xlsx, xls
            addLog('Parsing Excel (simulated)...');
            // We simulate XLSX parsing by directly using the CSV content for the org sheet
            localOrganizationSheetData = parseCSV(fileContent).map(row => row.map(cell => String(cell ?? '')));
            addLog(`Parsed Organizations sheet with ${localOrganizationSheetData.length} rows.`); // Log call fixed

            if (contactsContent) {
                const rawContactsDataFromExcel: string[][] = parseCSV(contactsContent).map(row => row.map(cell => String(cell ?? '')));
                addLog(`Found Contacts sheet with ${rawContactsDataFromExcel.length} rows.`); // Log call fixed
                if (rawContactsDataFromExcel.length > 0) {
                    const contactsHeaderForSample: string[] = rawContactsDataFromExcel[0];
                    const contactsBodyForSample: string[][] = rawContactsDataFromExcel.slice(1, Math.min(rawContactsDataFromExcel.length, TEST_DATA_ROW_COUNT + 1));
                    test_originalContactsSampleForCorrectionTestDisplay = [contactsHeaderForSample, ...contactsBodyForSample];
                    addLog(`Stored raw sample of ${contactsBodyForSample.length} contacts for testing.`); // Log call fixed

                    const fullyCorrectedContacts: string[][] = correctContactSheetAccountAssignments(rawContactsDataFromExcel);
                    test_rawContactsSheetData = fullyCorrectedContacts;
                    test_displayableCorrectedContactsData = fullyCorrectedContacts; // For verification
                    localContactsSheetDataForProcessing = fullyCorrectedContacts;
                    addLog(`Contacts sheet corrected. Full corrected version stored for pre-filling and download.`); // Log call fixed
                }
            }
        }

        if (localOrganizationSheetData.length === 0 || (localOrganizationSheetData.length === 1 && localOrganizationSheetData[0].every(cell => String(cell ?? '').trim() === ''))) {
            updateDisplayData([], fileExtension === 'csv' ? 'csv' : 'excel', 'Main sheet empty/unparsable.');
        } else {
            if (localContactsSheetDataForProcessing && localContactsSheetDataForProcessing.length > 1) {
                const { updatedOrgsData, prefilledCount } = prefillUrlsFromContacts(localOrganizationSheetData, localContactsSheetDataForProcessing);
                updateDisplayData(updatedOrgsData, 'contactPrefillInitial', `Parsed ${updatedOrgsData.length} rows. ${prefilledCount} URLs initially pre-filled from corrected contacts.`); // Log call fixed
            } else {
                updateDisplayData(localOrganizationSheetData, fileExtension === 'csv' ? 'csv' : 'excel', `Parsed ${localOrganizationSheetData.length} rows. No contacts pre-fill.`); // Log call fixed
            }
        }
    } catch (err: any) {
        console.error(`Error processing ${fileName}:`, err);
        updateDisplayData([], fileExtension === 'csv' ? 'csv' : 'excel', `Error: ${(err as Error).message}`);
    }
};

// --- Test Cases ---
const runTestCases = async (): Promise<void> => {
    console.log("--- Starting Test Case 1: Upload Basic CSV ---");
    await simplifiedHandleFileChange("test_orgs.csv", mockFileContents["test_orgs.csv"]);
    // Verification for Test Case 1
    console.log("Activity Log (Test 1):", JSON.stringify(test_activityLog, null, 2));
    console.log("Status Message (Test 1):", test_statusMessage);
    console.log("Display Data (Test 1):", JSON.stringify(test_displayData, null, 2));
    // Add more specific assertions here based on the test plan

    console.log("\n--- Starting Test Case 2: Upload Excel with Organizations and Contacts ---");
    await simplifiedHandleFileChange("test_excel.xlsx", mockFileContents["test_excel_Organizations.csv"], mockFileContents["test_excel_Contacts.csv"]);
    // Verification for Test Case 2
    console.log("Activity Log (Test 2):", JSON.stringify(test_activityLog, null, 2));
    console.log("Status Message (Test 2):", test_statusMessage);
    console.log("Display Data (Orgs) (Test 2):", JSON.stringify(test_displayData, null, 2));
    console.log("Corrected Contacts Data (Test 2 - for verification):", JSON.stringify(test_displayableCorrectedContactsData, null, 2));
    console.log("Original Contacts Sample (Test 2 - for verification):", JSON.stringify(test_originalContactsSampleForCorrectionTestDisplay, null, 2));
    // Add more specific assertions here

    console.log("\n--- Starting Test Case 3: Upload Unsupported File Type ---");
    const previousDisplayDataBeforeUnsupported: string[][] = JSON.parse(JSON.stringify(test_displayData)); // Deep copy
    await simplifiedHandleFileChange("unsupported.txt", mockFileContents["unsupported.txt"]);
    // Verification for Test Case 3
    console.log("Activity Log (Test 3):", JSON.stringify(test_activityLog, null, 2));
    console.log("Status Message (Test 3):", test_statusMessage);
    console.log("Display Data (Test 3 - should be unchanged):", JSON.stringify(test_displayData, null, 2));
    // Assert test_displayData is the same as previousDisplayDataBeforeUnsupported (or empty if this was the first file ever)
    // For now, manual check of log output. Automated check:
    if (JSON.stringify(test_displayData) !== JSON.stringify(previousDisplayDataBeforeUnsupported)) {
        console.error("ERROR Test Case 3: Display data changed after unsupported file upload!");
    }


    console.log("\n--- Starting Test Case 4: Upload Empty CSV File ---");
    await simplifiedHandleFileChange("empty.csv", mockFileContents["empty.csv"]);
    // Verification for Test Case 4
    console.log("Activity Log (Test 4):", JSON.stringify(test_activityLog, null, 2));
    console.log("Status Message (Test 4):", test_statusMessage);
    console.log("Display Data (Test 4):", JSON.stringify(test_displayData, null, 2));
    // Add more specific assertions here

    console.log("\n--- Test Execution Finished ---");
};

// To run the tests when this file is executed (e.g., with ts-node or after compiling to JS)
runTestCases();
// Exporting functions for potential direct invocation if needed by the execution environment.
// However, for SWE-bench, typically execution via a command is preferred.
// For now, we'll rely on `run_in_bash_session` to execute this.
// No explicit exports needed if running the whole file.
console.log("test_runner.ts loaded. Call runTestCases() to execute tests.");

// Small self-test for helper
const testPlausibleInternal = () => { // Renamed to avoid conflict if file is treated as module
    console.log("\n--- Self-test for isPlausibleUrl ---");
    console.log("isPlausibleUrl('google.com'):", isPlausibleUrl('google.com')); // true
    console.log("isPlausibleUrl('test@gmail.com'):", isPlausibleUrl('test@gmail.com')); // false
    console.log("isPlausibleUrl(''):", isPlausibleUrl('')); // false
    console.log("isPlausibleUrl('http://www.betaalready.com'):", isPlausibleUrl('www.betaalready.com')); // true
    console.log("isPlausibleUrl('betaalready.com'):", isPlausibleUrl('betaalready.com')); // true
    console.log("isPlausibleUrl('gmail.com'):", isPlausibleUrl('gmail.com')); // false
};
// testPlausibleInternal(); // Commented out for final test run

// Self-test for contact correction logic with slightly different indices
const testContactCorrectionIndicesInternal = () => { // Renamed
    console.log("\n--- Self-test for correctContactSheetAccountAssignments ---");
    const sampleContacts = [
        ["FirstName","LastName","Email","Title","Accounts::::ORG_NAME"],
        ["John","Doe","john.doe@alphadomain.com","Manager","Accounts::::Alpha Corp"],
        ["Alice","Brown","alice@gammadomain.net","Director","Accounts::::Gamma Inc "], // Note trailing space
        ["Eve","Blue","eve.blue@gammadomain.net","Rep","Accounts::::WRONG Corp"] // This should be corrected
    ];
    resetTestState(); // Reset log for this specific test
    const corrected = correctContactSheetAccountAssignments(sampleContacts);
    console.log("Self-test corrected contacts:", JSON.stringify(corrected, null, 2));
    console.log("Self-test activity log for contact correction:", JSON.stringify(test_activityLog, null, 2));
    // Expected: Eve Blue's account should be Accounts::::Gamma Inc
};
// testContactCorrectionIndicesInternal(); // Commented out for final test run

const testPrefillUrlsInternal = () => { // Renamed
    console.log("\n--- Self-test for prefillUrlsFromContacts ---");
    const orgs = [
        ["Organization Name","Website URL","Notes"],
        ["Alpha Corp","","Needs URL"],
        ["Beta Ltd","www.betaalready.com","Existing URL"],
        ["Gamma Inc","","To be pre-filled"],
        ["Delta Solutions","","Generic email contact"],
        ["Epsilon Services","www.epsilon.org","Keep this"]
    ];
    const contacts = [
        ["FirstName","LastName","Email","Title","Accounts::::ORG_NAME"],
        ["John","Doe","john.doe@alphadomain.com","Manager","Accounts::::Alpha Corp"], // prefill for Alpha Corp
        ["Jane","Smith","jane.s@betaalready.com","Analyst","Accounts::::Beta Ltd"], // Beta already has URL
        ["Alice","Brown","alice@gammadomain.net","Director","Accounts::::Gamma Inc"], // prefill for Gamma Inc
        ["Bob","Green","bob.green@gmail.com","Specialist","Accounts::::Delta Solutions"], // generic, skip
        ["Carol","White","carol@epsilon.org","CEO","Accounts::::Epsilon Services"] // Epsilon has URL, same domain
    ];
    resetTestState(); // Reset log for this specific test
    const { updatedOrgsData, prefilledCount } = prefillUrlsFromContacts(orgs, contacts);
    console.log("Self-test prefill URLs - updatedOrgsData:", JSON.stringify(updatedOrgsData, null, 2));
    console.log("Self-test prefill URLs - prefilledCount:", prefilledCount);
    console.log("Self-test prefill URLs - activityLog:", JSON.stringify(test_activityLog, null, 2));

    // Expected:
    // Alpha Corp -> alphadomain.com
    // Gamma Inc -> gammadomain.net
    // PrefilledCount = 2
    // Logs for Beta Ltd (skipped, existing plausible), Delta (skipped, generic), Epsilon (skipped, existing plausible)
};
// testPrefillUrlsInternal(); // Commented out for final test run
