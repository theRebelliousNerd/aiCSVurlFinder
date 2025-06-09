// test_runner_step2.ts

// --- Global State Variables (simplified) ---
let test_statusMessage: string = '';
let test_activityLog: string[] = [];

// Main data that would be in the JSON text area (represents csvData in App)
let currentMainData: string[][] = [];

// Data specific to contact correction testing
let test_originalContactsSampleForCorrectionTestDisplay: string[][] | null = null;
let test_correctedContactsTestDataForTable: string[][] | null = null;

// Data specific to URL pre-fill testing (simulates rawContactsSheetData from App state)
let test_rawContactsSheetDataForPrefill: string[][] | null = null;
let test_preprocessedTestDataForTable: string[][] | null = null; // Output of URL pre-fill test

// Data specific to deletion and merge testing
// These states will hold the output of each respective test step
let test_placeholderDeletedDataForTable: string[][] | null = null;
let test_mostlyEmptyDeletedDataForTable: string[][] | null = null;
let test_mergedTestDataForTable: string[][] | null = null;


const TEST_DATA_ROW_COUNT = 100; // From index.tsx, for sampling

// --- Logging and State Update Functions ---
const addLog = (message: string) => {
  test_activityLog.push(`[${new Date().toLocaleTimeString()}] ${message}`);
  console.log(`LOG: ${message}`);
};

const setStatus = (message: string) => {
    test_statusMessage = message;
    addLog(message);
    console.log(`STATUS: ${message}`);
};

const resetFullTestState = () => {
    test_statusMessage = '';
    test_activityLog = [];
    currentMainData = [];
    test_originalContactsSampleForCorrectionTestDisplay = null;
    test_correctedContactsTestDataForTable = null;
    test_rawContactsSheetDataForPrefill = null;
    test_preprocessedTestDataForTable = null;
    test_placeholderDeletedDataForTable = null;
    test_mostlyEmptyDeletedDataForTable = null;
    test_mergedTestDataForTable = null;
    // console.clear(); // Optional: if running in an env that supports it
    addLog("--- Global Test State Reset ---");
};


// --- Constants (from index.tsx) ---
const GENERIC_EMAIL_DOMAINS = [
  'gmail.com', 'yahoo.com', 'outlook.com', 'aol.com', 'hotmail.com',
  'icloud.com', 'live.com', 'msn.com', 'protonmail.com', 'zoho.com',
  'gmx.com', 'mail.com', 'yandex.com', 'comcast.net', 'verizon.net',
  'att.net', 'sbcglobal.net', 'bellsouth.net', 'cox.net', 'charter.net',
].map(d => d.toLowerCase());

// --- Helper Functions (copied or adapted from index.tsx / test_runner.ts) ---
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


// --- Core Logic Functions (Copied and adapted from index.tsx) ---

// Note: Using specific column indices as per previous findings for CSV files
// Organizations: Name (0), Website URL (1), Notes (2), Description (for deletion tests, index 2, but for full structure, index 63)
// Contacts: FirstName (0), LastName (1), Email (2), Title (3), Accounts::::ORG_NAME (4)

const correctContactSheetAccountAssignments = (originalContactsData: string[][]): string[][] => {
    addLog("Contact Correction: Starting process.");
    if (!originalContactsData || originalContactsData.length < 2) {
        addLog("Contact Correction: Sheet empty or no data rows. Skipping.");
        return originalContactsData.map(row => row.map(cell => String(cell ?? '')));
    }
    const domainToOrgNameMap = new Map<string, string>();
    const contactsHeader = originalContactsData[0].map(cell => String(cell ?? ''));
    const contactsBody = originalContactsData.slice(1).map(row => row.map(cell => String(cell ?? '')));
    let correctionsMade = 0;

    addLog("Contact Correction: Pass 1 - Building domain-to-org map.");
    contactsBody.forEach((contactRow) => {
        const email = String(contactRow[2] ?? '').trim(); // Email index
        const accountCell = String(contactRow[4] ?? '').trim(); // Accounts::::ORG_NAME index
        if (email && accountCell) {
            const domain = extractDomainFromEmail(email);
            // Org name matching for domain map building should be case-insensitive for the org name part
            const orgNameFromCell = accountCell.substring("accounts::::".length).trim();
            if (domain && !GENERIC_EMAIL_DOMAINS.includes(domain) && orgNameFromCell) {
                // Store a canonical (e.g., first encountered, or specific cased) org name for the domain
                // The lookup for org name during correction should also be case-insensitive
                // For simplicity, this map uses the orgNameFromCell as is, but lookups will be .toLowerCase()
                // For domain map key, always use lowercased domain.
                // For the value (org name), use the first one encountered that's not empty.
                const lowerCaseDomain = domain.toLowerCase();
                if (!domainToOrgNameMap.has(lowerCaseDomain) && orgNameFromCell) {
                     domainToOrgNameMap.set(lowerCaseDomain, orgNameFromCell);
                } else if (domainToOrgNameMap.has(lowerCaseDomain) && !domainToOrgNameMap.get(lowerCaseDomain) && orgNameFromCell){
                    // If previous entry for domain was empty org name, overwrite with current non-empty one
                    domainToOrgNameMap.set(lowerCaseDomain, orgNameFromCell);
                }
            }
        }
    });
    addLog(`Contact Correction: Pass 1 - Map built with ${domainToOrgNameMap.size} entries.`);

    const correctedContactsBody = contactsBody.map(row => [...row.map(cell => String(cell ?? ''))]);
    addLog("Contact Correction: Pass 2 - Applying corrections.");
    correctedContactsBody.forEach((contactRowToCorrect, index) => {
        const email = String(contactRowToCorrect[2] ?? '').trim();
        if (email) {
            const domain = extractDomainFromEmail(email);
            if (domain && domainToOrgNameMap.has(domain.toLowerCase())) { // Use toLowerCase for lookup
                const correctOrgName = domainToOrgNameMap.get(domain.toLowerCase())!;
                const expectedAccountCellValue = "Accounts::::" + correctOrgName; // Use canonical name from map

                while (contactRowToCorrect.length < 5) contactRowToCorrect.push('');
                const currentAccountCell = String(contactRowToCorrect[4] ?? ''); // Raw value for comparison

                // Compare intelligently: check if the org part matches case-insensitively
                const currentOrgNameFromCell = currentAccountCell.substring("accounts::::".length).trim();

                if (currentOrgNameFromCell.toLowerCase() !== correctOrgName.toLowerCase()) {
                    const oldValue = contactRowToCorrect[4];
                    contactRowToCorrect[4] = expectedAccountCellValue;
                    const contactName = `${String(contactRowToCorrect[0] ?? '')} ${String(contactRowToCorrect[1] ?? '')}`.trim() || `contact @ row ${index + 2}`;
                    addLog(`Contact Correction: Updated for ${contactName} (email: ${email}). From '${oldValue}' to '${expectedAccountCellValue}'.`);
                    correctionsMade++;
                }
            }
        }
    });
    addLog(`Contact Correction: Process complete. ${correctionsMade} corrections.`);
    return [contactsHeader, ...correctedContactsBody];
};

const prefillUrlsFromContacts = (orgsData: string[][], contactsData: string[][]): { updatedOrgsData: string[][], prefilledCount: number } => {
    addLog("URL Pre-fill: Starting process.");
    let prefilledCount = 0;
    const updatedOrgsData = orgsData.map(orgRow => [...orgRow.map(cell => String(cell ?? ''))]);

    if (updatedOrgsData.length > 0) { // Ensure URL header (index 1)
        const header = updatedOrgsData[0];
        while (header.length < 2) header.push('');
        if (String(header[1] ?? '').trim() === '') header[1] = "Website URL";
    }

    for (let i = 1; i < updatedOrgsData.length; i++) {
        const orgRow = updatedOrgsData[i];
        const orgName = String(orgRow[0] ?? '').trim(); // Org Name at index 0
        if (!orgName) continue;
        while (orgRow.length < 2) orgRow.push(''); // Ensure URL column exists

        if (isPlausibleUrl(String(orgRow[1] ?? ''))) {
             const existingUrl = String(orgRow[1] ?? '');
             if (!GENERIC_EMAIL_DOMAINS.some(genDomain => normalizeUrlForComparison(existingUrl).endsWith(genDomain))) {
                 addLog(`URL Pre-fill: Skipped for "${orgName}", plausible URL "${existingUrl}" exists.`);
                 continue;
            }
        }
        // Contacts: Email (2), Accounts::::ORG_NAME (4)
        for (const contactRow of contactsData.slice(1)) {
            const accountCell = String(contactRow[4] ?? '').trim();
            if (accountCell.toLowerCase().startsWith("accounts::::")) {
                const contactOrgName = accountCell.substring("accounts::::".length).trim();
                if (contactOrgName.toLowerCase() === orgName.toLowerCase()) { // Case-insensitive org name match
                    const email = String(contactRow[2] ?? '').trim();
                    if (email) {
                        const domain = extractDomainFromEmail(email);
                        if (domain && !GENERIC_EMAIL_DOMAINS.includes(domain)) {
                            orgRow[1] = domain; // Update URL at index 1
                            prefilledCount++;
                            addLog(`URL Pre-fill: Filled for "${orgName}" with "${domain}".`);
                            break;
                        } else if (domain && GENERIC_EMAIL_DOMAINS.includes(domain)) {
                             addLog(`URL Pre-fill: Skipped for "${orgName}", domain "${domain}" from email "${email}" is generic.`);
                        }
                    }
                }
            }
        }
    }
    addLog(`URL Pre-fill: Process complete. ${prefilledCount} URLs filled.`);
    return { updatedOrgsData, prefilledCount };
};

// Updated performPlaceholderDescRowDeletionLogic
const performPlaceholderDescRowDeletionLogic = (inputData: string[][], context: string): { cleanedData: string[][], rowsBefore: number, rowsDeleted: number } => {
    addLog(`Placeholder Row Deletion (${context}): Starting.`);
    if (!inputData || inputData.length < 2) {
        addLog(`Placeholder Row Deletion (${context}): No data or only header. Nothing to delete.`);
        return { cleanedData: inputData.map(r => r.map(c => String(c ?? ''))), rowsBefore: inputData.length > 0 ? inputData.length -1 : 0, rowsDeleted: 0 };
    }
    const headerRow = inputData[0].map(c => String(c ?? ''));
    const dataRows = inputData.slice(1).map(r => r.map(c => String(c ?? '')));
    const rowsBefore = dataRows.length;
    // For simplified orgs_for_deletion_tests.csv, Description is at index 2
    const DESCRIPTION_COL_INDEX = 2;
    const placeholderTextConstant = "Insufficient specific information available on the website to generate a detailed analytical profile for referral matchmaking.";

    const keptRows = dataRows.filter(row => {
        const orgName = String(row[0] ?? '').trim();

        let descriptionToCompare = "";
        if (row.length > DESCRIPTION_COL_INDEX) {
            descriptionToCompare = String(row[DESCRIPTION_COL_INDEX] ?? '').trim();
        }

        const descLower = descriptionToCompare.toLowerCase();
        const placeholderLower = placeholderTextConstant.toLowerCase();

        if (descLower === placeholderLower) {
            addLog(`Placeholder Row Deletion (${context}): Deleting row for "${orgName || 'Unnamed Org'}" due to placeholder text in col ${DESCRIPTION_COL_INDEX}.`);
            return false; // DELETE if placeholder matches
        }

        // If it's a row we are specifically debugging (i.e., expected it to be deleted but it wasn't)
        if (orgName.startsWith("DeletePlaceholder")) {
            addLog(`DEBUG: Mismatch for ${orgName}. Description did not match placeholder.`);
            addLog(`DEBUG: CSV Desc (len ${descriptionToCompare.length}): '${descriptionToCompare}' (Is it truly empty or misparsed?)`);
            addLog(`DEBUG: Const Text (len ${placeholderTextConstant.length}): '${placeholderTextConstant}'`);
        }
        return true; // KEEP otherwise
    });

    const cleanedData = [headerRow, ...keptRows];
    const rowsDeleted = rowsBefore - keptRows.length;
    addLog(`Placeholder Row Deletion (${context}): Complete. Rows before: ${rowsBefore}, after: ${keptRows.length}. Deleted: ${rowsDeleted}.`);
    return { cleanedData, rowsBefore, rowsDeleted };
};

// Updated performMostlyEmptyRowsLogic
const performMostlyEmptyRowsLogic = (inputData: string[][], context: string): { cleanedData: string[][], rowsBefore: number, rowsDeleted: number } => {
    addLog(`Mostly Empty Row Deletion (${context}): Starting.`);
    if (!inputData || inputData.length < 2) {
        addLog(`Mostly Empty Row Deletion (${context}): No data or only header. Nothing to delete.`);
        return { cleanedData: inputData.map(r => r.map(c => String(c ?? ''))), rowsBefore: inputData.length > 0 ? inputData.length -1 : 0, rowsDeleted: 0 };
    }
    const headerRow = inputData[0].map(c => String(c ?? ''));
    const dataRows = inputData.slice(1).map(r => r.map(c => String(c ?? '')));
    const rowsBefore = dataRows.length;
    // For simplified orgs_for_deletion_tests.csv, OrgName is at index 0, Description is at index 2.
    const ORG_NAME_COL_INDEX = 0;
    const DESCRIPTION_COL_INDEX = 2;

    const keptRows = dataRows.filter(row => {
        const orgName = String(row[ORG_NAME_COL_INDEX] ?? '').trim();

        // If OrgName is empty, keep the row only if it has other significant data.
        // For this specific logic, the original code implies that if OrgName is empty, the row is generally kept
        // unless it's entirely blank (which would be caught if description is also blank and allOtherCellsEmpty is true).
        // The primary target for this function is rows WITH an OrgName but little else.
        // Let's stick to the original logic's spirit: delete if OrgName is present and other fields (excluding desc) are empty.
        if (!orgName) { // If org name itself is empty, this rule doesn't apply in the same way.
            // However, if the whole row is empty (or only contains an empty description), it should be deleted.
            let isEffectivelyBlank = true;
            for(let i=0; i < row.length; i++) {
                if (i === DESCRIPTION_COL_INDEX && String(row[i] ?? '').trim() !== "") { // Description has content
                     // If only description is present and no org name, it might be an orphaned description.
                     // Depending on strictness, this could be a reason to delete.
                     // For now, let's say if org name is blank, and all other cells (excluding desc) are blank, we delete.
                } else if (i !== DESCRIPTION_COL_INDEX && String(row[i] ?? '').trim() !== "") {
                    isEffectivelyBlank = false;
                    break;
                }
            }
            if(isEffectivelyBlank){
                addLog(`Mostly Empty Row Deletion (${context}): Deleting row with empty OrgName and otherwise empty (excluding potential description).`);
                return false;
            }
            return true; // Keep rows with no org name if they have other data.
        }

        // This part is for rows with an OrgName
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
            // At this point, OrgName is present, and all fields *other than Description* are empty.
            // The original app's behavior for this case was to delete such rows.
            addLog(`Mostly Empty Row Deletion (${context}): Deleting row for "${orgName}" (All fields apart from OrgName & Description are empty).`);
            return false;
        }
        return true;
    });

    const cleanedData = [headerRow, ...keptRows];
    const rowsDeleted = rowsBefore - keptRows.length;
    addLog(`Mostly Empty Row Deletion (${context}): Complete. Rows before: ${rowsBefore}, after: ${keptRows.length}. Deleted: ${rowsDeleted}.`);
    return { cleanedData, rowsBefore, rowsDeleted };
};


// Updated performMergeDuplicatesLogic to use correct column indices for merge test file
const performMergeDuplicatesLogic = (inputData: string[][], context: string): { mergedData: string[][], rowsBefore: number, rowsAfter: number } => {
    addLog(`Merge Duplicates (${context}): Starting.`);
     if (!inputData || inputData.length < 2) {
      addLog(`Merge Duplicates (${context}): No data or only header. Nothing to merge.`);
      return { mergedData: inputData.map(r=>r.map(c=>String(c??''))), rowsBefore: inputData.length > 0 ? inputData.length -1 : 0, rowsAfter: inputData.length > 0 ? inputData.length -1 : 0 };
    }

    const headerRowOriginal = inputData[0].map(c => String(c ?? ''));
    // For orgs_for_merge_test.csv: OrgName (0), URL (1), Description (2), Industry (3)
    const ORG_NAME_COL_INDEX = 0;
    const URL_COL_INDEX = 1;
    const DESCRIPTION_COL_INDEX = 2;
    // Industry is index 3, not used in merge decision but part of data

    const dataRows = inputData.slice(1).map(r => r.map(c => String(c ?? '')));
    const rowsBeforeProcessing = dataRows.length;

    const groupedByOrgNameLC = new Map<string, string[][]>();
    dataRows.forEach(row => {
      const orgNameLC = String(row[ORG_NAME_COL_INDEX] ?? '').trim().toLowerCase();
      if (!orgNameLC) return;
      if (!groupedByOrgNameLC.has(orgNameLC)) {
        groupedByOrgNameLC.set(orgNameLC, []);
      }
      groupedByOrgNameLC.get(orgNameLC)!.push(row);
    });

    const finalMergedDataRows: string[][] = [];
    groupedByOrgNameLC.forEach((group, orgNameKeyLC) => {
      if (group.length === 1) {
        finalMergedDataRows.push(group[0]); return;
      }
      const originalOrgNameDisplay = String(group[0][ORG_NAME_COL_INDEX] ?? '').trim(); // For display and final output
      addLog(`Merge Duplicates (${context}): Processing group for "${originalOrgNameDisplay}" (${group.length} rows)`);

      let bestRawUrl = ''; let longestUrlLength = -1; let hasPlausibleUrlInGroup = false;
      let bestDescription = ''; let longestDescLength = -1;
      let representativeRowData = [...group[0]]; // Default

      group.forEach(currentRow => {
        const currentUrl = String(currentRow.length > URL_COL_INDEX ? currentRow[URL_COL_INDEX] : '').trim();
        if (isPlausibleUrl(currentUrl)) {
          if (!hasPlausibleUrlInGroup || currentUrl.length > longestUrlLength) {
            bestRawUrl = currentUrl; longestUrlLength = currentUrl.length; hasPlausibleUrlInGroup = true;
          }
        } else if (!hasPlausibleUrlInGroup && currentUrl.length > longestUrlLength) {
          bestRawUrl = currentUrl; longestUrlLength = currentUrl.length;
        }
        const currentDesc = String(currentRow.length > DESCRIPTION_COL_INDEX ? currentRow[DESCRIPTION_COL_INDEX] : '').trim();
        if (currentDesc.length > longestDescLength) {
          bestDescription = currentDesc; longestDescLength = currentDesc.length;
        }
      });

      // Choose representative row (prefer row that contributed best description, then best URL, else first)
      let repChosen = false;
      if (bestDescription) {
          for(const row of group) { if (String(row.length > DESCRIPTION_COL_INDEX ? row[DESCRIPTION_COL_INDEX] : '').trim() === bestDescription) { representativeRowData = [...row]; repChosen = true; break; }}
      }
      if (!repChosen && bestRawUrl) {
          for(const row of group) { if (String(row.length > URL_COL_INDEX ? row[URL_COL_INDEX] : '').trim() === bestRawUrl) { representativeRowData = [...row]; repChosen = true; break; }}
      }

      const mergedRowOutput = [...representativeRowData]; // Start with chosen representative
      const requiredLength = Math.max(headerRowOriginal.length, ORG_NAME_COL_INDEX + 1, URL_COL_INDEX + 1, DESCRIPTION_COL_INDEX + 1);
      while(mergedRowOutput.length < requiredLength) mergedRowOutput.push(''); // Pad if needed

      mergedRowOutput[ORG_NAME_COL_INDEX] = originalOrgNameDisplay; // Ensure original casing for org name
      mergedRowOutput[URL_COL_INDEX] = bestRawUrl;
      mergedRowOutput[DESCRIPTION_COL_INDEX] = bestDescription;

      finalMergedDataRows.push(mergedRowOutput);
      addLog(`Merge Duplicates (${context}): Merged "${originalOrgNameDisplay}". URL: "${bestRawUrl}", Desc: "${bestDescription.substring(0,30)}..."`);
    });

    let maxCols = headerRowOriginal.length;
    finalMergedDataRows.forEach(row => { maxCols = Math.max(maxCols, row.length); });
    const fullyPaddedHeader = [...headerRowOriginal];
    while(fullyPaddedHeader.length < maxCols) fullyPaddedHeader.push('');
    const fullyPaddedMergedDataRows = finalMergedDataRows.map(row => {
        const newRow = [...row.map(c => String(c ?? ''))];
        while (newRow.length < maxCols) newRow.push(''); return newRow;
    });

    const finalOutputData = [fullyPaddedHeader, ...fullyPaddedMergedDataRows];
    addLog(`Merge Duplicates (${context}): Complete. Rows before: ${rowsBeforeProcessing}, after: ${finalMergedDataRows.length}.`);
    return { mergedData: finalOutputData, rowsBefore: rowsBeforeProcessing, rowsAfter: finalMergedDataRows.length };
};


// --- Mocked File Data (populated by the calling environment or test setup) ---
let mockTestFiles: { [key: string]: string } = {
  "orgs_for_contact_test.csv": `Organization Name,Website URL,Notes
OrgWithContact,www.orgwithcontact.com,Initial
OrgForCorrection,,Needs Correction
AnotherOrg,www.another.com,Stable`,
  "contacts_for_correction.csv": `FirstName,LastName,Email,Title,Accounts::::ORG_NAME
Test,User,test@orgwithcontact.com,Tester,Accounts::::OrgWithContact
Correct,Me,correct@domain.com,Fixer,Accounts::::OrgForCorrection
Extra,Space,space@domain.com,Editor,Accounts::::OrgForCorrection
Wrong,Case,case@domain.com,Admin,Accounts::::orgforcorrection`,
  "orgs_for_url_prefill.csv": `Organization Name,Website URL,Notes
PrefillTarget1,,Should get domain1.com
PrefillTarget2,www.existing.com,Should keep existing
NoContactOrg,,No corresponding contact
GenericDomainOrg,,Will get generic email`,
  "corrected_contacts_for_url_prefill.csv": `FirstName,LastName,Email,Title,Accounts::::ORG_NAME
User,One,user1@domain1.com,Staff,Accounts::::PrefillTarget1
User,Two,user2@existing.com,Staff,Accounts::::PrefillTarget2
User,Three,user3@gmail.com,Staff,Accounts::::GenericDomainOrg`,
  "orgs_for_deletion_tests.csv": `Organization Name,Website URL,Description,Industry,Country
KeepMe,www.keep.com,Valid Description,Tech,USA
DeletePlaceholder1,www.delete1.com,Insufficient specific information available on the website to generate a detailed analytical profile for referral matchmaking.,Finance,UK
MostlyEmpty1,,,Business,Canada
KeepMe2,www.keep2.com,Another Valid,Services,USA
DeletePlaceholder2,,Insufficient specific information available on the website to generate a detailed analytical profile for referral matchmaking.,Retail,UK
MostlyEmpty2,,,,Description for mostly empty 2
FullValidRow,www.full.com,This row is full,Manufacturing,Germany`,
  "orgs_for_merge_test.csv": `Organization Name,Website URL,Description,Industry
MergeCorp,www.mergecorp.com,Basic info,Tech
MergeCorp,,More detailed description here,Tech
CombineInc,combine.com,Short desc,Finance
CombineInc,www.bettercombine.net,Medium desc,Finance
SoloInc,www.solo.com,Unique entry,Services
MergeCorp,www.bestmerge.dev,Most features,Tech`
};

// --- Test Logic Handlers ---

// Test Case 2.1: Contact Account Correction Test
const runContactCorrectionTestLogic = () => {
    addLog("--- Test Case 2.1: Contact Account Correction Test ---");
    setStatus("Test 2.1: Running Contact Account Correction Test...");

    // Setup: Load orgs_for_contact_test.csv (as main data - not used by this specific function)
    // and contacts_for_correction.csv (as raw contacts sheet for the test display).
    // The function correctContactSheetAccountAssignments only needs the contacts data.
    const contactsCsv = mockTestFiles["contacts_for_correction.csv"];
    if (!contactsCsv) { setStatus("Test 2.1 Error: contacts_for_correction.csv not loaded."); return; }

    test_originalContactsSampleForCorrectionTestDisplay = parseCSV(contactsCsv);
    if (test_originalContactsSampleForCorrectionTestDisplay.length < 1) {
        setStatus("Test 2.1 Error: Failed to parse contacts_for_correction.csv or it's empty."); return;
    }
    addLog(`Test 2.1: Loaded ${test_originalContactsSampleForCorrectionTestDisplay.length} raw rows from contacts_for_correction.csv`);

    test_correctedContactsTestDataForTable = correctContactSheetAccountAssignments(test_originalContactsSampleForCorrectionTestDisplay);

    setStatus("Test 2.1: Contact Account Correction Test Complete.");
    console.log("Test 2.1 Output - Corrected Contacts Data:", JSON.stringify(test_correctedContactsTestDataForTable, null, 2));
    console.log("Test 2.1 Output - Activity Log:", JSON.stringify(test_activityLog.slice(-10), null, 2)); // Log last 10 entries
};

// Test Case 2.2: Org URL Pre-processing Test
const runUrlPreprocessingTestLogic = () => {
    addLog("--- Test Case 2.2: Org URL Pre-processing Test ---");
    setStatus("Test 2.2: Running Org URL Pre-processing Test...");

    const orgsCsv = mockTestFiles["orgs_for_url_prefill.csv"];
    const contactsCsv = mockTestFiles["corrected_contacts_for_url_prefill.csv"];

    if (!orgsCsv || !contactsCsv) { setStatus("Test 2.2 Error: Test CSV files not loaded."); return; }

    currentMainData = parseCSV(orgsCsv); // This is what the prefill function will modify
    test_rawContactsSheetDataForPrefill = parseCSV(contactsCsv); // This is the 'corrected' contacts data to use

    if (currentMainData.length < 1 || test_rawContactsSheetDataForPrefill.length < 1) {
        setStatus("Test 2.2 Error: Failed to parse test CSVs or they are empty."); return;
    }
    addLog(`Test 2.2: Loaded ${currentMainData.length} org rows and ${test_rawContactsSheetDataForPrefill.length} contact rows.`);

    // Take a sample of main data for the test (as per UI logic for tests)
    const orgsSampleForTest = [currentMainData[0], ...currentMainData.slice(1, Math.min(currentMainData.length, TEST_DATA_ROW_COUNT + 1))];

    const { updatedOrgsData, prefilledCount } = prefillUrlsFromContacts(orgsSampleForTest, test_rawContactsSheetDataForPrefill);
    test_preprocessedTestDataForTable = updatedOrgsData;

    addLog(`Test 2.2: URL Pre-fill Test complete on sample. ${prefilledCount} URLs pre-filled.`);
    setStatus("Test 2.2: Org URL Pre-processing Test Complete.");
    console.log("Test 2.2 Output - Preprocessed Orgs Data:", JSON.stringify(test_preprocessedTestDataForTable, null, 2));
    console.log("Test 2.2 Output - Activity Log:", JSON.stringify(test_activityLog.slice(-10), null, 2));
};


// Test Case 2.3: Placeholder Row Deletion Test
const runPlaceholderDeletionTestLogic = () => {
    addLog("--- Test Case 2.3: Placeholder Row Deletion Test ---");
    setStatus("Test 2.3: Running Placeholder Row Deletion Test...");

    // Setup: Load orgs_for_deletion_tests.csv
    const orgsCsv = mockTestFiles["orgs_for_deletion_tests.csv"];
    if (!orgsCsv) { setStatus("Test 2.3 Error: orgs_for_deletion_tests.csv not loaded."); return; }

    currentMainData = parseCSV(orgsCsv);
    if (currentMainData.length < 1) { setStatus("Test 2.3 Error: Failed to parse orgs_for_deletion_tests.csv or it's empty."); return; }
    addLog(`Test 2.3: Loaded ${currentMainData.length} raw rows from orgs_for_deletion_tests.csv`);

    // Take a sample for the test
    const dataToProcess = [currentMainData[0], ...currentMainData.slice(1, Math.min(currentMainData.length, TEST_DATA_ROW_COUNT + 1))];

    const { cleanedData, rowsDeleted } = performPlaceholderDescRowDeletionLogic(dataToProcess, "Test 2.3");
    test_placeholderDeletedDataForTable = cleanedData;

    addLog(`Test 2.3: Placeholder Deletion Test complete on sample. ${rowsDeleted} rows removed.`);
    setStatus("Test 2.3: Placeholder Row Deletion Test Complete.");
    console.log("Test 2.3 Output - Placeholder Deleted Data:", JSON.stringify(test_placeholderDeletedDataForTable, null, 2));
    console.log("Test 2.3 Output - Activity Log:", JSON.stringify(test_activityLog.slice(-10), null, 2));
};

// Test Case 2.4: Mostly Empty Row Deletion Test
const runMostlyEmptyDeletionTestLogic = () => {
    addLog("--- Test Case 2.4: Mostly Empty Row Deletion Test ---");
    setStatus("Test 2.4: Running Mostly Empty Row Deletion Test...");

    // Setup: Use the output from 2.3 (test_placeholderDeletedDataForTable)
    // Or, if not available, reload orgs_for_deletion_tests.csv and simulate placeholder deletion.
    let dataToProcess: string[][];
    if (test_placeholderDeletedDataForTable && test_placeholderDeletedDataForTable.length > 0) {
        dataToProcess = test_placeholderDeletedDataForTable;
        addLog("Test 2.4: Using data from previous placeholder deletion test.");
    } else {
        addLog("Test 2.4: Previous placeholder deletion data not found. Reloading and re-simulating placeholder deletion.");
        const orgsCsv = mockTestFiles["orgs_for_deletion_tests.csv"];
        if (!orgsCsv) { setStatus("Test 2.4 Error: orgs_for_deletion_tests.csv not loaded."); return; }
        currentMainData = parseCSV(orgsCsv);
        if (currentMainData.length < 1) { setStatus("Test 2.4 Error: Failed to parse orgs_for_deletion_tests.csv or it's empty."); return; }
        const initialSample = [currentMainData[0], ...currentMainData.slice(1, Math.min(currentMainData.length, TEST_DATA_ROW_COUNT + 1))];
        const { cleanedData } = performPlaceholderDescRowDeletionLogic(initialSample, "Test 2.4_IntermediateStep");
        dataToProcess = cleanedData;
    }

    if (!dataToProcess || dataToProcess.length === 0) {
         setStatus("Test 2.4 Error: No data to process for mostly empty row deletion."); return;
    }

    const { cleanedData, rowsDeleted } = performMostlyEmptyRowsLogic(dataToProcess, "Test 2.4");
    test_mostlyEmptyDeletedDataForTable = cleanedData;

    addLog(`Test 2.4: Mostly Empty Row Deletion Test complete on sample. ${rowsDeleted} rows removed.`);
    setStatus("Test 2.4: Mostly Empty Row Deletion Test Complete.");
    console.log("Test 2.4 Output - Mostly Empty Deleted Data:", JSON.stringify(test_mostlyEmptyDeletedDataForTable, null, 2));
    console.log("Test 2.4 Output - Activity Log:", JSON.stringify(test_activityLog.slice(-10), null, 2));
};

// Test Case 2.5: Merge Duplicates Test
const runMergeDuplicatesTestLogic = () => {
    addLog("--- Test Case 2.5: Merge Duplicates Test ---");
    setStatus("Test 2.5: Running Merge Duplicates Test...");

    const orgsCsv = mockTestFiles["orgs_for_merge_test.csv"];
    if (!orgsCsv) { setStatus("Test 2.5 Error: orgs_for_merge_test.csv not loaded."); return; }

    currentMainData = parseCSV(orgsCsv);
    if (currentMainData.length < 1) { setStatus("Test 2.5 Error: Failed to parse orgs_for_merge_test.csv or it's empty."); return; }
    addLog(`Test 2.5: Loaded ${currentMainData.length} raw rows from orgs_for_merge_test.csv`);

    // Take a sample for the test
    const dataToProcess = [currentMainData[0], ...currentMainData.slice(1, Math.min(currentMainData.length, TEST_DATA_ROW_COUNT + 1))];

    const { mergedData, rowsBefore, rowsAfter } = performMergeDuplicatesLogic(dataToProcess, "Test 2.5");
    test_mergedTestDataForTable = mergedData;

    addLog(`Test 2.5: Merge Duplicates Test complete on sample. Rows before: ${rowsBefore}, after: ${rowsAfter}.`);
    setStatus("Test 2.5: Merge Duplicates Test Complete.");
    console.log("Test 2.5 Output - Merged Data:", JSON.stringify(test_mergedTestDataForTable, null, 2));
    console.log("Test 2.5 Output - Activity Log:", JSON.stringify(test_activityLog.slice(-10), null, 2));
};


// --- Main Test Execution Function ---
const runAllPreprocessingTests = async (fileContents: { [key: string]: string }) => {
    resetFullTestState();
    mockTestFiles = fileContents; // Make file contents available to test handlers

    runContactCorrectionTestLogic();
    runUrlPreprocessingTestLogic();
    runPlaceholderDeletionTestLogic();
    runMostlyEmptyDeletionTestLogic(); // This will use output from placeholder deletion if available
    runMergeDuplicatesTestLogic();

    console.log("\n\n--- All Preprocessing Tests Execution Finished ---");
    console.log("Final Activity Log:", JSON.stringify(test_activityLog, null, 2));
};

// Placeholder for direct execution if needed, actual execution will be triggered by external means
// For SWE Bench, the calling environment will handle this.

// Directly call runAllPreprocessingTests with the hardcoded mockTestFiles
runAllPreprocessingTests(mockTestFiles);

console.log("test_runner_step2.ts loaded and tests executed.");

export {}; // Ensures this is treated as a module by TypeScript if no other imports/exports exist.
