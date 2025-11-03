// Global variables
let csvData = [];
let currentTab = null;
let isFillMode = false;
let cachedEmailData = [];

// DOM elements
const csvFileInput = document.getElementById('csvFile');
const fileInfo = document.getElementById('fileInfo');
const fileName = document.getElementById('fileName');
const fileSize = document.getElementById('fileSize');
const previewSection = document.getElementById('previewSection');
const previewTable = document.getElementById('previewTable');
const previewHeader = document.getElementById('previewHeader');
const previewBody = document.getElementById('previewBody');
const subjectTemplate = document.getElementById('subjectTemplate');
const bodyTemplate = document.getElementById('bodyTemplate');
const openaiKeyInput = document.getElementById('openaiKey');
const personalizationPromptInput = document.getElementById('personalizationPrompt');
const createDraftsButton = document.getElementById('createDrafts');
const refreshButton = document.getElementById('refreshButton');
const status = document.getElementById('status');

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
    // Get current tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tabs[0];
    
    // Check if we're on Gmail
    if (!currentTab.url.includes('mail.google.com')) {
        showStatus('Please navigate to Gmail first', 'error');
        createDraftsButton.disabled = true;
    }
    
    // Set default templates
    subjectTemplate.value = 'Hello [name], regarding [company]';
    bodyTemplate.value = `Dear [name],

I hope this email finds you well. I'm reaching out regarding [company] and would like to discuss potential opportunities.

I would appreciate the opportunity to connect with you and learn more about your current initiatives.

Best regards,
[Your Name]`;

    // Load saved templates and CSV (if any)
    await loadSavedData();
    await restoreSavedCsv();
    
    // Check if there's an ongoing draft session
    await checkOngoingSession();
});

async function checkOngoingSession() {
    try {
        // Check storage directly - more reliable than content script communication
        const result = await chrome.storage.local.get(['emailData', 'currentRowIndex', 'csvData', 'templates']);
        
        if (result.emailData && result.currentRowIndex !== undefined) {
            const { currentRow, totalRows, remaining } = {
                currentRow: result.currentRowIndex + 1,
                totalRows: result.emailData.length,
                remaining: result.emailData.length - result.currentRowIndex
            };
            
            // Restore CSV data if available
            if (result.csvData && Array.isArray(result.csvData)) {
                csvData = result.csvData;
                showPreview();
                console.log('Restored CSV data:', csvData.length, 'rows');
            }
            
            // Restore templates if available
            if (result.templates) {
                subjectTemplate.value = result.templates.subject || '';
                bodyTemplate.value = result.templates.body || '';
                console.log('Restored templates');
            }

            showStatus(`Continuing draft session: ${currentRow}/${totalRows} (${remaining} remaining)`, 'info');
            createDraftsButton.textContent = 'Fill Next Draft';
            isFillMode = true;
        }
    } catch (error) {
        console.log('No ongoing session found');
    }
}

// File input change handler
csvFileInput.addEventListener('change', handleFileSelect);

// Primary action button handler
createDraftsButton.addEventListener('click', handlePrimaryButtonClick);

// Refresh handler
refreshButton.addEventListener('click', handleRefreshClick);

// Template change handlers
subjectTemplate.addEventListener('input', saveTemplates);
bodyTemplate.addEventListener('input', saveTemplates);
openaiKeyInput.addEventListener('input', saveOpenAISettings);
personalizationPromptInput.addEventListener('input', saveOpenAISettings);

async function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (!file.name.toLowerCase().endsWith('.csv')) {
        showStatus('Please select a CSV file', 'error');
        return;
    }
    
    // Show file info
    fileName.textContent = `File: ${file.name}`;
    fileSize.textContent = `Size: ${(file.size / 1024).toFixed(1)} KB`;
    fileInfo.style.display = 'block';
    
    // Read and parse CSV
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            csvData = parseCSV(e.target.result);
            if (csvData.length === 0) {
                showStatus('CSV file is empty', 'error');
                return;
            }
            
            // Validate CSV structure
            const requiredColumns = ['name', 'email', 'company'];
            const headers = Object.keys(csvData[0]);
            const missingColumns = requiredColumns.filter(col => !headers.includes(col.toLowerCase()));
            
            if (missingColumns.length > 0) {
                showStatus(`Missing required columns: ${missingColumns.join(', ')}`, 'error');
                return;
            }
            
            // Show preview
            showPreview();
            createDraftsButton.disabled = false;
            refreshButton.disabled = false;
            showStatus(`Loaded ${csvData.length} records`, 'success');
            // Persist CSV immediately
            try {
                await chrome.storage.local.set({ csvData });
                console.log('CSV data saved:', csvData.length, 'rows');
            } catch (storageError) {
                console.error('Failed to save CSV data:', storageError);
            }
            
        } catch (error) {
            showStatus('Error parsing CSV file: ' + error.message, 'error');
        }
    };
    reader.readAsText(file);
}

function parseCSV(csvText) {
    const lines = csvText.split('\n').filter(line => line.trim());
    if (lines.length < 2) return [];
    
    // Parse header
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
    
    // Parse data rows
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length === headers.length) {
            const row = {};
            headers.forEach((header, index) => {
                row[header] = values[index].trim().replace(/"/g, '');
            });
            data.push(row);
        }
    }
    
    return data;
}

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    
    result.push(current);
    return result;
}

function showPreview() {
    if (csvData.length === 0) return;
    
    // Clear previous preview
    previewHeader.innerHTML = '';
    previewBody.innerHTML = '';

    refreshButton.disabled = false;
    
    // Create header
    const headers = Object.keys(csvData[0]);
    const headerRow = document.createElement('tr');
    headers.forEach(header => {
        const th = document.createElement('th');
        th.textContent = header.charAt(0).toUpperCase() + header.slice(1);
        headerRow.appendChild(th);
    });
    previewHeader.appendChild(headerRow);
    
    // Create data rows (show first 5 rows)
    const rowsToShow = Math.min(5, csvData.length);
    for (let i = 0; i < rowsToShow; i++) {
        const row = document.createElement('tr');
        headers.forEach(header => {
            const td = document.createElement('td');
            td.textContent = csvData[i][header] || '';
            row.appendChild(td);
        });
        previewBody.appendChild(row);
    }
    
    if (csvData.length > 5) {
        const moreRow = document.createElement('tr');
        const moreCell = document.createElement('td');
        moreCell.colSpan = headers.length;
        moreCell.textContent = `... and ${csvData.length - 5} more rows`;
        moreCell.style.fontStyle = 'italic';
        moreCell.style.color = '#666';
        moreRow.appendChild(moreCell);
        previewBody.appendChild(moreRow);
    }
    
    previewSection.style.display = 'block';
}

async function restoreSavedCsv() {
    try {
        const result = await chrome.storage.local.get(['csvData']);
        if (result.csvData && Array.isArray(result.csvData) && result.csvData.length > 0) {
            csvData = result.csvData;
            showPreview();
            createDraftsButton.disabled = false;
            refreshButton.disabled = false;
            fileInfo.style.display = 'block';
            fileName.textContent = 'File: (restored from memory)';
            fileSize.textContent = `Rows: ${csvData.length}`;
            console.log('Restored CSV from storage:', csvData.length, 'rows');
        }
    } catch (e) {
        // ignore
    }
}

async function handlePrimaryButtonClick() {
    if (isFillMode) {
        await fillNextDraft();
    } else {
        await startDraftSession();
    }
}

async function handleRefreshClick() {
    const previousLabel = refreshButton.textContent;
    refreshButton.disabled = true;
    refreshButton.textContent = 'Refreshing...';

    try {
        await resetDraftSessionState();
        showStatus('Session refreshed. Ready to start from the first row.', 'success');
    } catch (error) {
        console.error('Failed to refresh session:', error);
        showStatus('Failed to refresh session: ' + error.message, 'error');
    } finally {
        refreshButton.textContent = previousLabel;
        refreshButton.disabled = csvData.length === 0;
    }
}

async function resetDraftSessionState() {
    isFillMode = false;
    cachedEmailData = [];
    createDraftsButton.textContent = 'Create Drafts';

    // Persist latest templates and settings
    saveTemplates();
    saveOpenAISettings();

    try {
        await chrome.storage.local.remove(['emailData', 'currentRowIndex', 'personalizedCache']);
    } catch (error) {
        console.warn('Failed to clear stored session data:', error);
    }

    if (csvData.length > 0) {
        try {
            await chrome.storage.local.set({ csvData });
        } catch (error) {
            console.warn('Failed to persist CSV data during refresh:', error);
        }
        showPreview();
    } else {
        previewSection.style.display = 'none';
        createDraftsButton.disabled = true;
    }

    if (currentTab?.id && currentTab?.url?.includes('mail.google.com')) {
        try {
            await ensureContentScriptInjected(currentTab.id);
            await sendMessageWithTimeout(currentTab.id, { action: 'resetSession' }, 3000);
        } catch (error) {
            console.warn('Unable to notify content script about refresh:', error);
        }
    }
}

async function startDraftSession() {
    if (csvData.length === 0) {
        showStatus('No CSV data loaded', 'error');
        return;
    }
    
    if (!currentTab.url.includes('mail.google.com')) {
        showStatus('Please navigate to Gmail first', 'error');
        return;
    }
    
    const subject = subjectTemplate.value.trim();
    const body = bodyTemplate.value.trim();
    const openaiKey = openaiKeyInput.value.trim();
    const personalizationPrompt = personalizationPromptInput.value.trim();
    const needsPersonalization = subject.includes('[insert specific info]') || body.includes('[insert specific info]');

    if (!subject || !body) {
        showStatus('Please fill in both subject and body templates', 'error');
        return;
    }

    if (needsPersonalization) {
        if (!openaiKey) {
            showStatus('Please add your OpenAI API key to use the [insert specific info] placeholder.', 'error');
            return;
        }
        if (!personalizationPrompt) {
            showStatus('Please provide a personalization prompt to use the [insert specific info] placeholder.', 'error');
            return;
        }
    }

    chrome.storage.local.set({
        openaiKey: openaiKey,
        personalizationPrompt: personalizationPrompt
    });

    // Prepare data for content script
    cachedEmailData = csvData.map((row, index) => ({
        name: row.name || '',
        email: row.email || '',
        company: row.company || '',
        personalized: '',
        rowIndex: index
    }));

    try {
        // Ensure content script is injected
        await ensureContentScriptInjected(currentTab.id);
        
        // Send data to content script for simple fill mode
        const response = await sendMessageWithTimeout(currentTab.id, {
            action: 'createDrafts',
            data: cachedEmailData,
            csvData: csvData,
            templates: {
                subject: subjectTemplate.value,
                body: bodyTemplate.value
            },
            openaiSettings: {
                key: openaiKey,
                prompt: personalizationPrompt,
                needsPersonalization,
                subjectTemplate: subjectTemplate.value,
                bodyTemplate: bodyTemplate.value
            }
        }, 10000);

        if (response && response.success) {
            showStatus(response.message, 'success');
            // Change button text to indicate next step
            createDraftsButton.textContent = 'Fill Next Draft';
            isFillMode = true;
        } else {
            showStatus('Error: ' + (response?.error || 'Unknown error'), 'error');
        }
    } catch (error) {
            showStatus('Failed to communicate with Gmail: ' + error.message, 'error');
    }
}

async function fillNextDraft() {
    try {
        if (!currentTab || !currentTab.id) {
            showStatus('Unable to access current tab. Please reopen the popup on Gmail.', 'error');
            return;
        }

        const response = await sendMessageWithTimeout(currentTab.id, {
            action: 'fillNext'
        }, 5000);

        if (response && response.success) {
            if (typeof response.filledIndex === 'number') {
                const filled = cachedEmailData.find(item => item.rowIndex === response.filledIndex);
                if (filled) {
                    showStatus(`Filled draft for ${filled.email || filled.name || 'row ' + (response.filledIndex + 1)}.`, 'success');
                } else {
                    showStatus(response.message, 'success');
                }
            } else {
                showStatus(response.message, 'success');
            }

            if (response.completed) {
                markSessionComplete();
            }
        } else {
            showStatus('Error filling draft: ' + (response?.error || response?.message || 'Unknown error'), 'error');
        }
    } catch (error) {
        showStatus('Failed to fill draft: ' + error.message, 'error');
    }
}

function markSessionComplete() {
    isFillMode = false;
    createDraftsButton.textContent = 'Create Drafts';
    showStatus('All drafts completed!', 'success');
}

async function ensureContentScriptInjected(tabId, force = false) {
    return new Promise(async (resolve, reject) => {
        try {
            await chrome.scripting.executeScript({
                target: { tabId },
                files: ['content.js']
            });

            const verify = (attempt = 0) => {
                chrome.tabs.sendMessage(tabId, { action: 'ping' }, (response) => {
                    if (chrome.runtime.lastError || !response) {
                        if (attempt < 3) {
                            setTimeout(() => verify(attempt + 1), 300);
                        } else {
                            const message = chrome.runtime.lastError?.message || 'Content script did not respond';
                            reject(new Error(`Content script not reachable after multiple attempts: ${message}`));
                        }
                    } else {
                        resolve();
                    }
                });
            };

            verify(0);
        } catch (e) {
            reject(e);
        }
    });
}

function sendMessageWithTimeout(tabId, message, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error('Timeout: no response from Gmail'));
        }, timeout);

        chrome.tabs.sendMessage(tabId, message, (response) => {
            clearTimeout(timer);
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(response);
            }
        });
    });
}

function replaceBaseVariables(template, data) {
    if (!template) return '';
    return template
        .replace(/\[name\]/g, data.name || '')
        .replace(/\[email\]/g, data.email || '')
        .replace(/\[company\]/g, data.company || '');
}

function replaceTemplateVariables(template, data) {
    const withBaseVariables = replaceBaseVariables(template, data);
    return withBaseVariables.replace(/\[insert specific info\]/g, data.personalized || '');
}

async function personalizeEmails(emailData, promptTemplate, apiKey, subjectTemplateText, bodyTemplateText) {
    for (let index = 0; index < emailData.length; index++) {
        const email = emailData[index];
        const prompt = buildPrompt(promptTemplate, email, subjectTemplateText, bodyTemplateText).trim();

        if (!prompt) {
            email.personalized = '';
            continue;
        }

        try {
            const personalization = await requestPersonalizedParagraph(prompt, apiKey);
            email.personalized = personalization;
        } catch (error) {
            const identifier = email.company || email.name || `row ${index + 1}`;
            throw new Error(`Failed to personalize for ${identifier}: ${error.message}`);
        }
    }
}

function buildPrompt(promptTemplate, email, subjectTemplateText, bodyTemplateText) {
    const basePrompt = replaceBaseVariables(promptTemplate, email);
    const subjectContext = replaceBaseVariables(subjectTemplateText, email);
    const bodyContextBefore = getContextBeforeInsert(bodyTemplateText, email, true);
    const bodyContextAfter = getContextAfterInsert(bodyTemplateText, email, true);

    let contextualPrompt = `${basePrompt.trim()}`;

    if (subjectTemplateText && subjectTemplateText.includes('[insert specific info]')) {
        contextualPrompt += `\n\nThe email subject template is: "${subjectTemplateText}".`;
    } else if (subjectContext) {
        contextualPrompt += `\n\nThe resolved subject line is: "${subjectContext}".`;
    }

    if (bodyContextBefore || bodyContextAfter) {
        contextualPrompt += '\n\nThe email body will contain: ';
        contextualPrompt += bodyContextBefore ? `Before the insert: "${bodyContextBefore}". ` : '';
        contextualPrompt += bodyContextAfter ? `After the insert: "${bodyContextAfter}".` : '';
    }

    contextualPrompt += '\n\nReturn exactly the 2-3 sentence snippet that should replace [insert specific info].';

    return contextualPrompt;
}

function getContextBeforeInsert(bodyTemplateText, email, resolveVariables) {
    const [before] = bodyTemplateText.split('[insert specific info]');
    if (!before) return '';
    return resolveVariables ? replaceBaseVariables(before, email) : before;
}

function getContextAfterInsert(bodyTemplateText, email, resolveVariables) {
    const parts = bodyTemplateText.split('[insert specific info]');
    if (parts.length < 2) return '';
    const after = parts.slice(1).join('[insert specific info]');
    return resolveVariables ? replaceBaseVariables(after, email) : after;
}

async function requestPersonalizedParagraph(prompt, apiKey) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: 'You craft concise, friendly email outreach paragraphs. Keep it to 2-3 sentences tailored to the provided details.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.7,
                max_tokens: 200
            })
        });

        const data = await response.json();

        if (!response.ok) {
            const message = data?.error?.message || response.statusText || 'Unknown error';
            throw new Error(message);
        }

        const content = data?.choices?.[0]?.message?.content?.trim();
        if (!content) {
            throw new Error('Received empty response from OpenAI.');
        }

        return content;
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error('Request to OpenAI timed out.');
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

function showStatus(message, type = 'info') {
    status.textContent = message;
    status.className = `status ${type}`;
    status.style.display = 'block';
    
    // Auto-hide success messages after 3 seconds
    if (type === 'success') {
        setTimeout(() => {
            status.style.display = 'none';
        }, 3000);
    }
}

function saveTemplates() {
    const templates = {
        subject: subjectTemplate.value,
        body: bodyTemplate.value
    };
    chrome.storage.local.set({ templates });
}

function saveOpenAISettings() {
    const settings = {
        openaiKey: openaiKeyInput.value,
        personalizationPrompt: personalizationPromptInput.value
    };
    chrome.storage.local.set(settings);
}

async function loadSavedData() {
    try {
        const result = await chrome.storage.local.get(['templates', 'openaiKey', 'personalizationPrompt']);
        if (result.templates) {
            subjectTemplate.value = result.templates.subject || subjectTemplate.value;
            bodyTemplate.value = result.templates.body || bodyTemplate.value;
            console.log('Restored templates from storage');
        }

        if (result.openaiKey) {
            openaiKeyInput.value = result.openaiKey;
        }

        if (result.personalizationPrompt) {
            personalizationPromptInput.value = result.personalizationPrompt;
        }
    } catch (error) {
        console.error('Failed to load saved templates:', error);
    }
}
