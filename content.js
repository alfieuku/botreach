// Gmail Draft Creator - SIMPLE FILL MODE
console.log('🔥 SIMPLE FILL MODE: Gmail Draft Creator loaded');

// Load saved data on startup
loadSavedData();

// Ensure we're always ready to receive messages
console.log('🔥 Content script loaded and ready');

// Listen for messages from popup (top frame only)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    try {
    // Ignore messages in subframes
    if (window.top !== window.self) {
        return;
    }

    if (request.action === 'ping') {
        sendResponse({ ok: true });
        return;
    }
    
    if (request.action === 'createDrafts') {
        // Store the data and reset index
        saveDataToStorage(request.data, 0, request.csvData, request.templates, request.openaiSettings, request.attachments || []);
        console.log(`🔥 SIMPLE FILL: Ready to fill ${request.data.length} drafts`);
        
        sendResponse({ success: true, message: `Ready to fill ${request.data.length} drafts. Click the button for each draft.` });
        return;
    }
    
    if (request.action === 'fillNext') {
        fillCurrentCompose()
            .then((result) => {
                if (result?.completed) {
                    sendResponse({ success: true, message: 'All drafts completed', completed: true });
                } else {
                    sendResponse({ success: true, message: 'Filled current compose window', completed: false });
                }
            })
            .catch((error) => {
                sendResponse({ success: false, error: error.message });
            });
        return true;
    }

    if (request.action === 'resetSession') {
        resetDraftProgress()
            .then(() => {
                sendResponse({ success: true });
            })
            .catch((error) => {
                sendResponse({ success: false, error: error.message });
            });
        return true;
    }
    
    if (request.action === 'getStatus') {
        const status = getCurrentStatus();
        sendResponse({ success: true, status: status });
        return;
    }
    
    if (request.action === 'getSavedData') {
        loadSavedData().then((savedData) => {
            sendResponse({ success: true, data: savedData });
        });
        return true; // Keep the message channel open for async response
    }
    } catch (error) {
        console.error('Message handling error:', error);
        sendResponse({ success: false, error: error.message });
        return;
    }
});

async function loadSavedData() {
    try {
        const result = await chrome.storage.local.get(['emailData', 'currentRowIndex', 'csvData', 'templates', 'openaiSettings', 'personalizedCache', 'attachments']);
        if (result.emailData && result.currentRowIndex !== undefined) {
            window.emailData = result.emailData;
            window.currentRowIndex = result.currentRowIndex;
            console.log(`🔥 RESTORED: Row ${currentRowIndex + 1}/${emailData.length} from storage`);
        }
        
        window.openaiSettings = result.openaiSettings || null;
        window.personalizedCache = result.personalizedCache || {};
        window.csvData = result.csvData || null;
        window.attachments = Array.isArray(result.attachments) ? result.attachments : [];

        // Return CSV data and templates for popup to use
        return {
            csvData: result.csvData || null,
            templates: result.templates || null,
            hasSession: result.emailData && result.currentRowIndex !== undefined,
            openaiSettings: window.openaiSettings || null,
            attachments: window.attachments || []
        };
    } catch (error) {
        console.log('No saved data found');
        return { csvData: null, templates: null, hasSession: false };
    }
}

async function saveDataToStorage(emailData, index, csvData = null, templates = null, openaiSettings = null, attachments = null) {
    try {
        const dataToSave = {
            emailData: emailData,
            currentRowIndex: index
        };
        
        // Save CSV data and templates if provided
        if (csvData) {
            dataToSave.csvData = csvData;
            console.log(`🔥 SAVING CSV: ${csvData.length} rows`);
            window.csvData = csvData;
        }
        if (templates) {
            dataToSave.templates = templates;
            console.log(`🔥 SAVING TEMPLATES: Subject and body`);
        }
        if (openaiSettings) {
            dataToSave.openaiSettings = openaiSettings;
            console.log('🔥 SAVING OPENAI SETTINGS: Stored key & prompt metadata');
        }
        if (attachments) {
            dataToSave.attachments = attachments;
            console.log(`🔥 SAVING ATTACHMENTS: ${attachments.length} file(s)`);
            window.attachments = attachments;
        }
        
        await chrome.storage.local.set(dataToSave);
        window.emailData = emailData;
        window.currentRowIndex = index;
        if (openaiSettings) {
            window.openaiSettings = openaiSettings;
        }
        console.log(`🔥 SAVED: ${emailData.length} drafts, starting at row ${index + 1}`);
        
        // Verify what was actually saved
        const verification = await chrome.storage.local.get(['csvData', 'templates', 'openaiSettings']);
        console.log(`🔥 VERIFICATION: CSV rows saved: ${verification.csvData?.length || 0}, Templates saved: ${verification.templates ? 'Yes' : 'No'}, OpenAI settings saved: ${verification.openaiSettings ? 'Yes' : 'No'}`);
        
    } catch (error) {
        console.error('Failed to save data:', error);
        
        // Check if it's a storage quota error
        if (error.message && error.message.includes('quota')) {
            console.error('Storage quota exceeded - CSV data might be too large');
        }
    }
}

async function updateCurrentIndex(index) {
    try {
        await chrome.storage.local.set({ currentRowIndex: index });
        window.currentRowIndex = index;
    } catch (error) {
        console.error('Failed to update index:', error);
    }
}

async function completeDraftSession() {
    await chrome.storage.local.remove(['emailData', 'currentRowIndex']);
    window.emailData = null;
    window.currentRowIndex = undefined;
}

async function resetDraftProgress() {
    await completeDraftSession();
    window.personalizedCache = {};
    window.openaiSettings = null;
    await chrome.storage.local.remove(['personalizedCache']);
    console.log('🔥 SESSION RESET: Draft progress cleared');
}

function getCurrentStatus() {
    if (!window.emailData || window.currentRowIndex === undefined) {
        return { hasData: false };
    }
    
    return {
        hasData: true,
        currentRow: window.currentRowIndex + 1,
        totalRows: window.emailData.length,
        remaining: window.emailData.length - window.currentRowIndex
    };
}

async function fillCurrentCompose() {
    if (!window.emailData || window.currentRowIndex >= window.emailData.length) {
        console.log('✅ ALL DRAFTS COMPLETE: No more rows to fill');
        showNotification('All drafts completed! 🎉');
        await completeDraftSession();
        return { completed: true };
    }
    
    const currentPosition = window.currentRowIndex;
    const currentEmail = window.emailData[currentPosition];
    const resolvedRowIndex = typeof currentEmail.rowIndex === 'number' ? currentEmail.rowIndex : currentPosition;

    if (!currentEmail.email || !currentEmail.email.trim()) {
        const fallbackRow = Array.isArray(window.csvData) ? window.csvData[resolvedRowIndex] : null;
        const fallbackEmail = fallbackRow?.email || fallbackRow?.Email || fallbackRow?.EMAIL || '';
        if (fallbackEmail && typeof fallbackEmail === 'string') {
            currentEmail.email = fallbackEmail.trim();
            console.log(`⚙️ Restored missing email for row ${resolvedRowIndex + 1} from CSV data.`);
        }
    }

    if (!currentEmail.email || !currentEmail.email.trim()) {
        throw new Error(`Missing email address for row ${resolvedRowIndex + 1}`);
    }

    console.log(`🔥 FILLING ROW ${resolvedRowIndex + 1}/${window.emailData.length}: ${currentEmail.email}`);
    
    try {
        await ensurePersonalization(currentEmail);

        // Fill recipients first
        await fillRecipients(currentEmail.email);

        // Fill subject
        fillSubject(currentEmail.subject);
        
        // Fill body
        fillBody(currentEmail.body);
        
        // Attach files if configured
        await attachFilesToCompose();
        
        // Update the index and save to storage
        const nextIndex = resolvedRowIndex + 1;
        await updateCurrentIndex(nextIndex);
        
        const remaining = window.emailData.length - nextIndex;
        showNotification(`Filled draft ${nextIndex}/${window.emailData.length}. ${remaining} remaining.`);
        
        console.log(`✅ FILLED: Row ${nextIndex}/${window.emailData.length}`);
        
        return { completed: false, remaining, filledIndex: resolvedRowIndex };
    } catch (error) {
        console.error('❌ FILL ERROR:', error);
        showNotification(`Error filling draft: ${error.message}`);
        const shouldContinue = handleFillError(error, resolvedRowIndex);
        if (shouldContinue) {
            const newIndex = resolvedRowIndex + 1;
            await updateCurrentIndex(newIndex);
            if (newIndex >= window.emailData.length) {
                await completeDraftSession();
                return { completed: true };
            }
            showNotification(`Skipped row ${newIndex}. Continuing to next recipient.`);
            return fillCurrentCompose();
        }
        throw error;
    }
}

function handleFillError(error, index) {
    const message = (error?.message || '').toLowerCase();
    if (message.includes('no email address') || message.includes('missing email address')) {
        console.warn(`Row ${index + 1} is missing an email address.`);
        return false;
    }
    if (message.includes('gmail compose window not ready') || message.includes('email field not found')) {
        console.warn(`Compose window not ready for row ${index + 1}. Stopping to avoid skipping.`);
        return false;
    }
    if (message.includes('compose window not found')) {
        console.warn(`Compose window not ready for row ${index + 1}.`);
        return false;
    }
    return false;
}

async function findRecipientFieldWithRetry(composeWindow, selectors, retries = 3, delayMs = 150) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        for (const selector of selectors) {
            const field = composeWindow.querySelector(selector);
            if (field) {
                console.log(`🔥 FOUND EMAIL FIELD: ${selector}`);
                return field;
            }
        }

        if (attempt < retries) {
            await sleep(delayMs * (attempt + 1));
        }
    }

    return null;
}

async function attachFilesToCompose() {
    if (!Array.isArray(window.attachments) || window.attachments.length === 0) {
        return;
    }

    const composeWindow = getActiveComposeWindow();
    if (!composeWindow) {
        throw new Error('Compose window not found for attachments');
    }

    // Remove existing attachments to avoid duplicates
    const removeButtons = composeWindow.querySelectorAll('[aria-label^="Remove attachment"], [aria-label^="Remove file"], [aria-label="Remove"]');
    removeButtons.forEach(button => {
        try {
            button.click();
        } catch (error) {
            console.warn('Failed to remove existing attachment:', error);
        }
    });
    if (removeButtons.length > 0) {
        await sleep(150);
    }

    let fileInput = composeWindow.querySelector('input[type="file"][name="Filedata"]');
    if (!fileInput) {
        fileInput = composeWindow.querySelector('input[type="file"]');
    }

    if (!fileInput) {
        const attachCommand = composeWindow.querySelector('div[command="Files"] input[type="file"], div[command="Files"]');
        if (attachCommand instanceof HTMLInputElement) {
            fileInput = attachCommand;
        } else if (attachCommand) {
            attachCommand.click();
            await sleep(200);
            fileInput = composeWindow.querySelector('input[type="file"][name="Filedata"]') || composeWindow.querySelector('input[type="file"]');
        }
    }

    if (!fileInput) {
        throw new Error('Attachment input not found');
    }

    const dataTransfer = new DataTransfer();
    for (const attachment of window.attachments) {
        if (!attachment?.data || !attachment?.name) {
            continue;
        }

        try {
            const file = base64ToFile(attachment.data, attachment.name, attachment.type || 'application/octet-stream');
            dataTransfer.items.add(file);
        } catch (error) {
            console.error('Attachment preparation failed:', error);
            throw new Error(`Failed to prepare attachment: ${attachment?.name || 'unknown file'}`);
        }
    }

    if (dataTransfer.items.length === 0) {
        return;
    }

    fileInput.files = dataTransfer.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(400);
}

function base64ToFile(base64String, filename, mimeType) {
    try {
        const sanitized = base64String.replace(/^data:[^;]+;base64,/, '');
        const byteCharacters = atob(sanitized);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        return new File([byteArray], filename, { type: mimeType || 'application/octet-stream' });
    } catch (error) {
        throw new Error('Invalid attachment encoding');
    }
}

async function ensurePersonalization(emailData) {
    const settings = window.openaiSettings || {};
    const subjectTemplate = settings.subjectTemplate || '';
    const bodyTemplate = settings.bodyTemplate || '';

    if (!subjectTemplate || !bodyTemplate) {
        throw new Error('Email templates not available.');
    }

    if (!window.personalizedCache) {
        window.personalizedCache = {};
    }

    const cacheKey = (
        emailData.email ||
        emailData.company ||
        emailData.name ||
        (typeof emailData.rowIndex === 'number' ? `row_${emailData.rowIndex}` : `row_${window.currentRowIndex}`)
    ).toLowerCase();
    let personalizedSnippet = window.personalizedCache[cacheKey] || '';

    if (settings.needsPersonalization) {
        if (!settings.key) {
            throw new Error('OpenAI API key missing.');
        }
        if (!settings.prompt) {
            throw new Error('Personalization prompt missing.');
        }

        if (!personalizedSnippet) {
            personalizedSnippet = await personalizeSingleEmail(emailData, settings);
            window.personalizedCache[cacheKey] = personalizedSnippet;
            await chrome.storage.local.set({ personalizedCache: window.personalizedCache });
        }
    }

    applyTemplatesToEmail(emailData, subjectTemplate, bodyTemplate, personalizedSnippet);
    await chrome.storage.local.set({ emailData: window.emailData });
}

function applyTemplatesToEmail(emailData, subjectTemplate, bodyTemplate, personalizedSnippet) {
    const templateData = {
        name: emailData.name || '',
        email: emailData.email || '',
        company: emailData.company || '',
        personalized: personalizedSnippet || ''
    };

    emailData.personalized = templateData.personalized;
    emailData.subject = replaceTemplateVariables(subjectTemplate, templateData);
    emailData.body = replaceTemplateVariables(bodyTemplate, templateData);
}

async function personalizeSingleEmail(emailData, settings) {
    const prompt = buildPrompt(
        settings.prompt,
        emailData,
        settings.subjectTemplate,
        settings.bodyTemplate
    ).trim();

    if (!prompt) {
        return '';
    }

    return requestPersonalizedParagraph(prompt, settings.key);
}

function buildPrompt(promptTemplate, emailData, subjectTemplateText, bodyTemplateText) {
    const baseData = {
        name: emailData.name || '',
        email: emailData.email || '',
        company: emailData.company || ''
    };

    const basePrompt = replaceBaseVariables(promptTemplate, baseData).trim();
    let contextualPrompt = basePrompt;

    if (subjectTemplateText) {
        if (subjectTemplateText.includes('[insert specific info]')) {
            contextualPrompt += `\n\nThe email subject template is: "${subjectTemplateText}".`;
        } else {
            const resolvedSubject = replaceBaseVariables(subjectTemplateText, baseData);
            if (resolvedSubject) {
                contextualPrompt += `\n\nThe resolved subject line is: "${resolvedSubject}".`;
            }
        }
    }

    const bodyContextBefore = getContextBeforeInsert(bodyTemplateText, baseData);
    const bodyContextAfter = getContextAfterInsert(bodyTemplateText, baseData);

    if (bodyContextBefore || bodyContextAfter) {
        contextualPrompt += '\n\nThe email body will contain: ';
        contextualPrompt += bodyContextBefore ? `Before the insert: "${bodyContextBefore}". ` : '';
        contextualPrompt += bodyContextAfter ? `After the insert: "${bodyContextAfter}".` : '';
    }

    contextualPrompt += '\n\nReturn exactly one sentence that should replace [insert specific info].';

    return contextualPrompt;
}

function replaceBaseVariables(template, data) {
    if (!template) {
        return '';
    }

    return template
        .replace(/\[name\]/g, data.name || '')
        .replace(/\[email\]/g, data.email || '')
        .replace(/\[company\]/g, data.company || '');
}

function replaceTemplateVariables(template, data) {
    const withBaseVariables = replaceBaseVariables(template, data);
    return withBaseVariables.replace(/\[insert specific info\]/g, data.personalized || '');
}

function getContextBeforeInsert(bodyTemplateText, data) {
    if (!bodyTemplateText) {
        return '';
    }

    const [before] = bodyTemplateText.split('[insert specific info]');
    if (!before) {
        return '';
    }

    return replaceBaseVariables(before, data).trim();
}

function getContextAfterInsert(bodyTemplateText, data) {
    if (!bodyTemplateText) {
        return '';
    }

    const parts = bodyTemplateText.split('[insert specific info]');
    if (parts.length < 2) {
        return '';
    }

    const after = parts.slice(1).join('[insert specific info]');
    return replaceBaseVariables(after, data).trim();
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
                model: 'gpt-4.1',
                messages: [
                    {
                        role: 'system',
                        content: 'Fitting in with the tone and content of the rest of the email body template, fill in a useful context based on the company that we\'re emailing that will make our email look more specific to that particular company. It can be a recent development in the company or a particular feature about that company that pairs well with what we\'re offering. Make it fit in with the rest of the email so that it doesn’t sound like generic ChatGPT structured fill while also fitting in with the rest of the professional vibe of the email. Don’t write more than 1 sentence. Keep it direct and honest and how an undergraduate would sound while also maintaining professionalism. That means avoiding words like “inspiring” or “groundbreaking” that would make it seem obviously not written by a competent student.'
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

        return enforceSingleSentence(content);
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error('Request to OpenAI timed out.');
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

function enforceSingleSentence(text) {
    const cleaned = (text || '').replace(/\s+/g, ' ').trim();
    if (!cleaned) {
        return '';
    }

    const sentences = cleaned.split(/(?<=[.!?])\s+/);
    const first = sentences[0]?.trim();
    if (first) {
        return first.endsWith('.') || first.endsWith('!') || first.endsWith('?') ? first : `${first}.`;
    }

    return cleaned;
}

async function fillRecipients(email) {
    if (!email) {
        throw new Error('No email address provided');
    }

    const recipients = email
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);

    if (recipients.length === 0) {
        throw new Error('No email address provided');
    }

    console.log(`🔥 FILLING EMAIL FIELD: "${recipients.join(', ')}"`);

    let composeWindow = getActiveComposeWindow();
    if (!composeWindow) {
        console.warn('Compose window not found, retrying...');
        for (let attempt = 0; attempt < 3 && !composeWindow; attempt++) {
            await sleep(150 * (attempt + 1));
            composeWindow = getActiveComposeWindow();
        }
    }
    if (!composeWindow) {
        throw new Error('Compose window not found');
    }

    const recipientSelectors = [
        'textarea[name="to"]',
        'input[name="to"]',
        'textarea[aria-label="To"]',
        'input[aria-label="To"]',
        'div[aria-label="To"]',
        'div[aria-label^="To "]',
        'div[aria-label*="Add recipients"]',
        'div[role="combobox"][aria-label*="Recipients"]',
        '.oj div[role="textbox"]',
        '.oj div[contenteditable="true"]'
    ];

    const recipientField = await findRecipientFieldWithRetry(composeWindow, recipientSelectors);
    if (!recipientField) {
        throw new Error('Gmail compose window not ready: email field not found');
    }

    let editableElement = recipientField;

    if (recipientField.tagName === 'DIV') {
        const nestedEditable = recipientField.querySelector('textarea, input, div[contenteditable="true"]');
        if (nestedEditable) {
            editableElement = nestedEditable;
        }
    }

    console.log('🔥 EMAIL FIELD TYPE:', editableElement.tagName, editableElement.getAttribute('contenteditable'));

    // Clear existing recipient chips if any
    const chips = composeWindow.querySelectorAll('div[role="listitem"][data-hovercard-id]');
    chips.forEach(chip => {
        const removeButton = chip.querySelector('[aria-label*="Remove"], [aria-label*="Delete"], [tabindex][role="button"]');
        if (removeButton) {
            removeButton.click();
        } else {
            chip.remove();
        }
    });

    editableElement.focus();

    const recipientString = recipients.join(', ');

    if ('value' in editableElement) {
        editableElement.value = '';
        editableElement.dispatchEvent(new Event('input', { bubbles: true }));
        editableElement.value = recipientString;
        editableElement.dispatchEvent(new Event('input', { bubbles: true }));
        editableElement.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (editableElement.getAttribute && editableElement.getAttribute('contenteditable') === 'true') {
        editableElement.innerHTML = '';
        editableElement.textContent = '';
        editableElement.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'deleteContentBackward' }));
        editableElement.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: recipientString }));
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, recipientString);
    } else {
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, recipientString);
    }

    // As a final fallback, type via keyboard events if the field is still empty
    await sleep(50);
    const currentValue = editableElement.value || editableElement.textContent || '';
    if (!currentValue.trim()) {
        console.log('⚠️ Email field still empty, typing via keyboard events');
        await typeWithKeyboard(editableElement, recipientString);
    }

    await sleep(50);

    // Simulate Enter to convert to Gmail chips
    const enterDown = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true });
    const enterUp = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true });
    editableElement.dispatchEvent(enterDown);
    editableElement.dispatchEvent(enterUp);

    editableElement.dispatchEvent(new Event('blur', { bubbles: true }));

    await sleep(150);

    const addedChips = composeWindow.querySelectorAll('div[role="listitem"][data-hovercard-id]');
    if (!addedChips || addedChips.length < recipients.length) {
        console.warn('⚠️ Email chip count does not match recipients after insertion');
    }

    console.log('✅ EMAIL FIELD FILLED');
}

async function typeWithKeyboard(element, text) {
    element.focus();
    const chars = text.split('');
    for (const char of chars) {
        const keyDown = new KeyboardEvent('keydown', { key: char, bubbles: true });
        const keyPress = new KeyboardEvent('keypress', { key: char, bubbles: true });
        const keyUp = new KeyboardEvent('keyup', { key: char, bubbles: true });
        element.dispatchEvent(keyDown);
        element.dispatchEvent(keyPress);
        element.dispatchEvent(new InputEvent('input', { bubbles: true, data: char, inputType: 'insertText' }));
        element.dispatchEvent(keyUp);
        await sleep(10);
    }
}

function getActiveComposeWindow() {
    const composeDialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
    for (const dialog of composeDialogs) {
        if (dialog.offsetParent === null) {
            continue; // hidden
        }
        if (dialog.querySelector('textarea[name="to"], div[aria-label="To"], input[name="to"]')) {
            return dialog;
        }
    }
    return null;
}

function fillSubject(subject) {
    console.log(`🔥 FILLING SUBJECT: "${subject}"`);
    
    // Try multiple subject field selectors
    const subjectSelectors = [
        'input[name="subjectbox"]',
        'input[placeholder*="Subject"]',
        'input[aria-label*="Subject"]',
        '.aoT[role="textbox"]',
        'div[aria-label*="Subject"]',
        'input[placeholder*="subject"]',
        'input[aria-label*="subject"]',
        'div[aria-label*="subject"]',
        '.aoT',
        'input[type="text"]'
    ];
    
    let subjectField = null;
    for (const selector of subjectSelectors) {
        subjectField = document.querySelector(selector);
        if (subjectField) {
            console.log(`🔥 FOUND SUBJECT FIELD: ${selector}`);
            break;
        }
    }
    
    if (!subjectField) {
        throw new Error('Subject field not found');
    }
    
    // Clear and fill subject
    subjectField.focus();
    subjectField.value = '';
    subjectField.textContent = '';
    subjectField.innerHTML = '';
    
    // Set the subject
    if (subjectField.tagName === 'INPUT') {
        subjectField.value = subject;
    } else {
        subjectField.textContent = subject;
    }
    
    // Trigger events
    subjectField.dispatchEvent(new Event('input', { bubbles: true }));
    subjectField.dispatchEvent(new Event('change', { bubbles: true }));
    
    console.log('✅ SUBJECT FILLED');
}

function fillBody(body) {
    console.log(`🔥 FILLING BODY...`);
    
    // Try multiple body field selectors
    const bodySelectors = [
        'div[contenteditable="true"][role="textbox"]',
        'div[aria-label*="Message Body"]',
        'div[aria-label*="Compose"]',
        '.Am.Al.editable',
        '[role="textbox"]',
        'div[contenteditable="true"]',
        'div[aria-label*="message"]',
        'div[aria-label*="body"]',
        'div[aria-label*="Message"]',
        '.Am.Al',
        'div[contenteditable]',
        'div[role="textbox"][contenteditable]'
    ];
    
    let bodyField = null;
    for (const selector of bodySelectors) {
        bodyField = document.querySelector(selector);
        if (bodyField) {
            console.log(`🔥 FOUND BODY FIELD: ${selector}`);
            break;
        }
    }
    
    if (!bodyField) {
        throw new Error('Body field not found');
    }
    
    // Clear and fill body
    bodyField.focus();
    
    // Clear existing content
    bodyField.innerHTML = '';
    bodyField.textContent = '';
    
    // Convert line breaks to HTML
    const htmlBody = body.replace(/\n/g, '<br>');
    bodyField.innerHTML = htmlBody;
    
    // Trigger events
    bodyField.dispatchEvent(new Event('input', { bubbles: true }));
    bodyField.dispatchEvent(new Event('change', { bubbles: true }));
    
    console.log('✅ BODY FILLED');
}

function showNotification(message) {
    // Create a simple notification
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #4CAF50;
        color: white;
        padding: 15px 20px;
        border-radius: 5px;
        z-index: 10000;
        font-family: Arial, sans-serif;
        font-size: 14px;
        box-shadow: 0 4px 8px rgba(0,0,0,0.2);
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    // Remove after 3 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 3000);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}