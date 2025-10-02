        const outputDiv = document.getElementById("console-container");
        const inputElement = document.getElementById("input");
        const connectBleButton = document.getElementById("connectBleButton");

        // Command registry - MUST be defined early for extensions
        const commands = {};

        // Storage for loaded modules and scripts
        const wasmModules = {};
        const loadedScripts = {};
        const uploadedScripts = {}; // Scripts stored in localStorage

        // Make helper classes globally available
        window.NTAG215Database = null;
        window.NTAG215Reader = null;

        // Initialize FileSystemManager
        let fs = null;
        let currentSelectedFile = null;

        async function initFileSystem() {
            try {
                fs = new FileSystemManager();
                await fs.init();
                window.fs = fs; // Make it globally accessible
                logToConsole('✓ Virtual filesystem initialized');

                // Create default directories
                await fs.mkdir('/helpers');
                await fs.mkdir('/scripts');
                await fs.mkdir('/data');
                await fs.mkdir('/extensions');

                // Load and display file tree
                await refreshFileTree();

                // Load extensions
                await loadExtensions();
            } catch (error) {
                logToConsole(`Error initializing filesystem: ${error.message}`, true);
            }
        }

        function logToConsole(message, isError = false) {
            const div = document.createElement("div");
            div.textContent = message;
            if (isError) {
                div.classList.add("error");
            }
            outputDiv.appendChild(div);
            outputDiv.scrollTop = outputDiv.scrollHeight; // Auto-scroll to bottom
        }

        function clearConsole() {
            outputDiv.innerHTML = '';
        }
        window.clearConsole = clearConsole;

        function sayHello() {
            logToConsole("Hello from page function!");
        }

        // Load uploaded scripts from localStorage on page load
        function loadUploadedScripts() {
            const scripts = JSON.parse(localStorage.getItem('chameleonScripts') || '{}');
            Object.assign(uploadedScripts, scripts);
            updateScriptsList();
        }

        // Save uploaded scripts to localStorage
        function saveUploadedScripts() {
            localStorage.setItem('chameleonScripts', JSON.stringify(uploadedScripts));
        }

        // Upload and store script files
        async function uploadScriptFiles(files) {
            for (const file of files) {
                try {
                    const content = await file.text();
                    uploadedScripts[file.name] = {
                        name: file.name,
                        content: content,
                        uploadedAt: new Date().toISOString()
                    };
                    logToConsole(`✓ Uploaded: ${file.name}`);
                } catch (error) {
                    logToConsole(`Error uploading ${file.name}: ${error.message}`, true);
                }
            }
            saveUploadedScripts();
            updateScriptsList();
        }

        // Execute a stored script
        async function executeScript(scriptName) {
            if (!uploadedScripts[scriptName]) {
                logToConsole(`Script '${scriptName}' not found`, true);
                return;
            }

            try {
                logToConsole(`▶ Running: ${scriptName}`);
                const scriptFunc = new Function(uploadedScripts[scriptName].content);
                const result = scriptFunc.call(window);

                // Handle async functions
                if (result && typeof result.then === 'function') {
                    await result;
                }
            } catch (error) {
                logToConsole(`Error executing ${scriptName}: ${error.message}`, true);
            }
        }

        // Delete a script
        function deleteScript(scriptName) {
            if (confirm(`Delete script "${scriptName}"?`)) {
                delete uploadedScripts[scriptName];
                saveUploadedScripts();
                updateScriptsList();
                logToConsole(`✓ Deleted: ${scriptName}`);
            }
        }

        // Clear all scripts
        function clearAllScripts() {
            if (confirm('Delete ALL uploaded scripts?')) {
                Object.keys(uploadedScripts).forEach(name => delete uploadedScripts[name]);
                saveUploadedScripts();
                updateScriptsList();
                logToConsole('✓ All scripts cleared');
            }
        }

        // Update the scripts list UI
        function updateScriptsList() {
            const listEl = document.getElementById('scriptsList');
            listEl.innerHTML = '';

            const scripts = Object.values(uploadedScripts);
            if (scripts.length === 0) {
                listEl.innerHTML = '<li style="border: none; background: none;">No scripts uploaded</li>';
                return;
            }

            scripts.sort((a, b) => a.name.localeCompare(b.name));

            scripts.forEach(script => {
                const li = document.createElement('li');

                const nameSpan = document.createElement('span');
                nameSpan.className = 'script-name';
                nameSpan.textContent = script.name;

                const runBtn = document.createElement('button');
                runBtn.textContent = 'Run';
                runBtn.className = 'small';
                runBtn.onclick = () => executeScript(script.name);

                const deleteBtn = document.createElement('button');
                deleteBtn.textContent = 'Delete';
                deleteBtn.className = 'small danger';
                deleteBtn.onclick = () => deleteScript(script.name);

                li.appendChild(nameSpan);
                li.appendChild(runBtn);
                li.appendChild(deleteBtn);
                listEl.appendChild(li);
            });
        }

        // Load a WebAssembly module from /bin directory
        async function loadWasm(moduleName) {
            try {
                logToConsole(`Loading WASM module: ${moduleName}...`);
                const moduleScript = await import(`./bin/${moduleName}.js`);
                const wasmModule = await moduleScript.default();
                wasmModules[moduleName] = wasmModule;
                logToConsole(`✓ WASM module '${moduleName}' loaded successfully`);
                return wasmModule;
            } catch (error) {
                logToConsole(`Error loading WASM module '${moduleName}': ${error.message}`, true);
                throw error;
            }
        }

        // Load an external JavaScript file (supports virtual filesystem paths)
        async function loadJS(scriptPath) {
            try {
                logToConsole(`Loading JS file: ${scriptPath}...`);

                let scriptContent;

                // Check if it's a virtual filesystem path (starts with /)
                if (scriptPath.startsWith('/') && fs) {
                    try {
                        scriptContent = await fs.readFile(scriptPath);
                        logToConsole(`  ↳ Loaded from virtual filesystem`);
                    } catch (fsError) {
                        // If not found in VFS, try relative path
                        logToConsole(`  ↳ Not in VFS, trying relative path...`);
                        const response = await fetch('.' + scriptPath);
                        if (!response.ok) throw new Error(`HTTP ${response.status}`);
                        scriptContent = await response.text();
                    }
                } else {
                    // Regular fetch for relative paths
                    const response = await fetch(scriptPath);
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    scriptContent = await response.text();
                }

                // Execute script in global context so it has access to all app functions
                const scriptFunc = new Function(scriptContent);
                scriptFunc.call(window);

                loadedScripts[scriptPath] = true;
                logToConsole(`✓ JS file '${scriptPath}' loaded successfully`);
            } catch (error) {
                logToConsole(`Error loading JS file '${scriptPath}': ${error.message}`, true);
                throw error;
            }
        }

        // Load external library from CDN
        async function loadScript(url, globalName = null) {
            try {
                logToConsole(`Loading library: ${url}...`);

                return new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = url;
                    script.onload = () => {
                        if (globalName && window[globalName]) {
                            logToConsole(`✓ Library '${globalName}' loaded successfully`);
                        } else {
                            logToConsole(`✓ Library loaded successfully`);
                        }
                        resolve(globalName ? window[globalName] : true);
                    };
                    script.onerror = () => {
                        const error = new Error(`Failed to load library: ${url}`);
                        logToConsole(`Error loading library: ${error.message}`, true);
                        reject(error);
                    };
                    document.head.appendChild(script);
                });
            } catch (error) {
                logToConsole(`Error loading library: ${error.message}`, true);
                throw error;
            }
        }

        // Load ES module from CDN
        async function loadModule(url) {
            try {
                logToConsole(`Loading ES module: ${url}...`);
                const module = await import(url);
                logToConsole(`✓ ES module loaded successfully`);
                return module;
            } catch (error) {
                logToConsole(`Error loading ES module: ${error.message}`, true);
                throw error;
            }
        }

        const NRF_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
        const UART_RX_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // Characteristic for receiving data from device
        const UART_TX_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // Characteristic for sending data to device

        // Command constants from ChameleonUltra firmware
        const CMD_SET_ACTIVE_SLOT = 1003;
        const CMD_GET_ACTIVE_SLOT = 1018;
        const CMD_GET_SLOT_INFO = 1019;
        const CMD_GET_ALL_SLOT_NICKS = 1038;
        const CMD_GET_ENABLED_SLOTS = 1023;
        const CMD_SET_SLOT_TAG_TYPE = 1004;
        const CMD_SET_SLOT_DATA_DEFAULT = 1005;
        const CMD_SET_SLOT_ENABLE = 1006;
        const CMD_DELETE_SLOT_INFO = 1024;
        const CMD_GET_BATTERY_INFO = 1025;
        const CMD_MF1_SET_ANTICOLLISION = 4001;
        const CMD_MF0_NTAG_WRITE_EMU_PAGE_DATA = 4022;
        const CMD_MF0_NTAG_READ_EMU_PAGE_DATA = 4021;
        const CMD_MF0_NTAG_GET_VERSION_DATA = 4023;
        const CMD_MF0_NTAG_SET_VERSION_DATA = 4024;
        const CMD_MF0_NTAG_GET_SIGNATURE_DATA = 4025;
        const CMD_MF0_NTAG_SET_SIGNATURE_DATA = 4026;
        const CMD_MF0_NTAG_SET_WRITE_MODE = 4032;
        const CMD_MF0_NTAG_SET_UID_MAGIC_MODE = 4020;
        const CMD_SLOT_DATA_CONFIG_SAVE = 1009;
        const CMD_SET_SLOT_TAG_NICK = 1007;
        const CMD_GET_SLOT_TAG_NICK = 1008;

        const TagType = { NTAG_215: 1101 };
        const TagFrequency = { HF: 2 }; // HF frequency value

        // Tag type mapping
        const TAG_TYPE_NAMES = {
            0: 'Undefined',
            // LF Tags
            100: 'EM410X',
            101: 'EM410X/16',
            102: 'EM410X/32',
            103: 'EM410X/64',
            170: 'Viking',
            200: 'HID Prox',
            // HF Tags
            1000: 'MIFARE Mini',
            1001: 'MIFARE Classic 1K',
            1002: 'MIFARE Classic 2K',
            1003: 'MIFARE Classic 4K',
            1100: 'NTAG 213',
            1101: 'NTAG 215',
            1102: 'NTAG 216',
            1103: 'MIFARE Ultralight',
            1104: 'MIFARE Ultralight C',
            1105: 'MIFARE Ultralight EV1 (640bit)',
            1106: 'MIFARE Ultralight EV1 (1312bit)',
            1107: 'NTAG 210',
            1108: 'NTAG 212'
        };

        function getTagTypeName(typeCode) {
            return TAG_TYPE_NAMES[typeCode] || `Unknown (${typeCode})`;
        }

        // Function to handle device disconnection
        function onDisconnected(event) {
            logToConsole(`Device ${event.target.name} disconnected.`, true);
            // Re-enable connect button or update UI as needed

            // Trigger extension hooks
            if (window.ChameleonAPI) {
                window.ChameleonAPI.chameleonUltra = null;
                window.ChameleonAPI._trigger('onDeviceDisconnected');
            }
        }

        class ChameleonUltraBLE {
            constructor() {
                this.device = null;
                this.txCharacteristic = null; // Device sends notifications on this
                this.rxCharacteristic = null; // We write commands to this
                this.responseCallbacks = {};
                this.silentCommands = {}; // Track which commands should not be logged
                this.responseBuffer = new Uint8Array();
                this.SOF = 0x11;
                this.MAX_DATA_LENGTH = 4096;
            }

            // Calculate LRC checksum
            lrcCalc(array) {
                let ret = 0x00;
                for (let b of array) {
                    ret += b;
                    ret &= 0xFF;
                }
                return (0x100 - ret) & 0xFF;
            }

            // Make binary data frame: SOF(1)|LRC1(1)|CMD(2)|STATUS(2)|LENGTH(2)|LRC2(1)|DATA(n)|LRC3(1)
            makeDataFrame(cmd, data = null, status = 0) {
                if (data === null) data = new Uint8Array(0);
                const dataLen = data.length;

                // Create frame buffer
                const frameLen = 1 + 1 + 2 + 2 + 2 + 1 + dataLen + 1;
                const frame = new Uint8Array(frameLen);
                let offset = 0;

                // SOF
                frame[offset++] = this.SOF;

                // LRC1 (placeholder)
                const lrc1Pos = offset++;

                // CMD (big-endian uint16)
                frame[offset++] = (cmd >> 8) & 0xFF;
                frame[offset++] = cmd & 0xFF;

                // STATUS (big-endian uint16)
                frame[offset++] = (status >> 8) & 0xFF;
                frame[offset++] = status & 0xFF;

                // LENGTH (big-endian uint16)
                frame[offset++] = (dataLen >> 8) & 0xFF;
                frame[offset++] = dataLen & 0xFF;

                // LRC2 (placeholder)
                const lrc2Pos = offset++;

                // DATA
                if (dataLen > 0) {
                    frame.set(data, offset);
                    offset += dataLen;
                }

                // LRC3 (placeholder)
                const lrc3Pos = offset;

                // Calculate LRCs
                frame[lrc1Pos] = this.lrcCalc(frame.slice(0, lrc1Pos));
                frame[lrc2Pos] = this.lrcCalc(frame.slice(0, lrc2Pos));
                frame[lrc3Pos] = this.lrcCalc(frame.slice(0, lrc3Pos));

                return frame;
            }

            async connect() {
                this.device = await navigator.bluetooth.requestDevice({
                    filters: [{ services: [NRF_SERVICE_UUID] }],
                    optionalServices: [NRF_SERVICE_UUID] // Include optional services if needed
                });
                this.device.addEventListener('gattserverdisconnected', this.onDisconnected.bind(this));
                const server = await this.device.gatt.connect();
                const service = await server.getPrimaryService(NRF_SERVICE_UUID);

                this.txCharacteristic = await service.getCharacteristic(UART_TX_UUID); // Device sends notifications on this
                this.rxCharacteristic = await service.getCharacteristic(UART_RX_UUID); // We write commands to this

                // Set up notification listener on the TX characteristic (where device sends data)
                this.txCharacteristic.addEventListener('characteristicvaluechanged', this.handleNotifications.bind(this));
                await this.txCharacteristic.startNotifications();
            }

            onDisconnected(event) {
                logToConsole(`Device ${event.target.name} disconnected.`, true);
                // You might want to update UI elements here, e.g., re-enable connect button
            }

            handleNotifications(event) {
                const value = new Uint8Array(event.target.value.buffer);

                // Append new data to buffer
                const newBuffer = new Uint8Array(this.responseBuffer.length + value.length);
                newBuffer.set(this.responseBuffer);
                newBuffer.set(value, this.responseBuffer.length);
                this.responseBuffer = newBuffer;

                // Try to parse complete frames
                this.parseFrames();
            }

            parseFrames() {
                while (this.responseBuffer.length > 0) {
                    // Need at least header: SOF(1) + LRC1(1) + CMD(2) + STATUS(2) + LENGTH(2) + LRC2(1) = 9 bytes
                    if (this.responseBuffer.length < 9) break;

                    // Check SOF
                    if (this.responseBuffer[0] !== this.SOF) {
                        logToConsole("Invalid SOF, skipping byte", true);
                        this.responseBuffer = this.responseBuffer.slice(1);
                        continue;
                    }

                    // Verify LRC1
                    if (this.responseBuffer[1] !== this.lrcCalc(this.responseBuffer.slice(0, 1))) {
                        logToConsole("LRC1 mismatch", true);
                        this.responseBuffer = this.responseBuffer.slice(1);
                        continue;
                    }

                    // Parse header
                    const cmd = (this.responseBuffer[2] << 8) | this.responseBuffer[3];
                    const status = (this.responseBuffer[4] << 8) | this.responseBuffer[5];
                    const dataLen = (this.responseBuffer[6] << 8) | this.responseBuffer[7];

                    // Check if we have complete frame
                    const frameLen = 9 + dataLen + 1;
                    if (this.responseBuffer.length < frameLen) break;

                    // Verify LRC2
                    if (this.responseBuffer[8] !== this.lrcCalc(this.responseBuffer.slice(0, 8))) {
                        logToConsole("LRC2 mismatch", true);
                        this.responseBuffer = this.responseBuffer.slice(1);
                        continue;
                    }

                    // Extract data
                    const data = this.responseBuffer.slice(9, 9 + dataLen);

                    // Verify LRC3
                    if (this.responseBuffer[9 + dataLen] !== this.lrcCalc(this.responseBuffer.slice(0, 9 + dataLen))) {
                        logToConsole("LRC3 mismatch", true);
                        this.responseBuffer = this.responseBuffer.slice(1);
                        continue;
                    }

                    // Valid frame received
                    this.handleResponse(cmd, status, data);

                    // Remove processed frame from buffer
                    this.responseBuffer = this.responseBuffer.slice(frameLen);
                }
            }

            handleResponse(cmd, status, data) {
                const statusNames = {
                    0x00: 'HF_TAG_OK',
                    0x68: 'SUCCESS',
                    0x60: 'PAR_ERR',
                    0x67: 'INVALID_CMD'
                };
                const statusName = statusNames[status] || `0x${status.toString(16)}`;

                // Check if this command should be logged
                const callback = this.responseCallbacks[cmd];
                if (callback) {
                    // Check if this command was marked as silent
                    const isSilent = this.silentCommands && this.silentCommands[cmd];

                    const response = { cmd, status, data };
                    callback(response);

                    // Only log if not marked as silent
                    if (!isSilent) {
                        logToConsole(`← CMD=${cmd} Status=${statusName} Data(${data.length})=${Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
                    }

                    delete this.responseCallbacks[cmd];
                    if (this.silentCommands) delete this.silentCommands[cmd];
                }
            }

            async sendCmd(cmd, data = null, status = 0, timeout = 3000, silent = false) {
                return new Promise(async (resolve, reject) => {
                    if (!this.device || !this.device.gatt.connected) {
                        return reject(new Error('Device not connected'));
                    }

                    // Build frame
                    const frame = this.makeDataFrame(cmd, data, status);

                    if (!silent) {
                        logToConsole(`→ CMD=${cmd} Data(${data ? data.length : 0})=${data ? Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ') : ''}`);
                    }

                    // Set up response callback
                    const timeoutId = setTimeout(() => {
                        delete this.responseCallbacks[cmd];
                        delete this.silentCommands[cmd];
                        reject(new Error('Command response timed out'));
                    }, timeout);

                    // Store silent flag for this command
                    if (silent) {
                        if (!this.silentCommands) this.silentCommands = {};
                        this.silentCommands[cmd] = true;
                    }

                    this.responseCallbacks[cmd] = (response) => {
                        clearTimeout(timeoutId);
                        resolve(response);
                    };

                    // Send frame
                    await this.rxCharacteristic.writeValue(frame);
                });
            }

            // Helper method to send command by number
            async cmd(cmdNum, data = null, silent = false) {
                return await this.sendCmd(cmdNum, data, 0, 3000, silent);
            }
        }

        let chameleonUltra = null; // Instance of the new class

        connectBleButton.addEventListener("click", async () => {
            logToConsole("Attempting to connect to BLE device...");
            try {
                chameleonUltra = new ChameleonUltraBLE();
                await chameleonUltra.connect();

                logToConsole(`Connected to: ${chameleonUltra.device.name || 'Unknown Device'}`);
                logToConsole("GATT server connected. Service and characteristics discovered. Notifications started on TX.");

                // Update API reference
                window.ChameleonAPI.chameleonUltra = chameleonUltra;

                // Trigger extension hooks
                window.ChameleonAPI._trigger('onDeviceConnected', chameleonUltra);

            } catch (error) {
                logToConsole(`BLE Connection Error: ${error}`, true);
            }
        });

        // File input handler
        document.getElementById('fileInput').addEventListener('change', async (e) => {
            const files = Array.from(e.target.files);
            if (files.length > 0) {
                await uploadScriptFiles(files);
                e.target.value = ''; // Reset file input
            }
        });

        // Initialize CodeMirror editor
        let codeEditor;
        let editorInitialized = false;

        window.addEventListener('DOMContentLoaded', () => {
            // Check URL parameters FIRST before initializing editor
            const urlParams = new URLSearchParams(window.location.search);
            const hasURLScript = urlParams.has('script') || urlParams.has('load');

            // Define custom autocomplete hints for Chameleon API
            const chameleonHints = {
                // BLE Commands
                'chameleonUltra': ['cmd', 'sendCmd', 'device', 'connect', 'disconnect'],
                'CMD_': [
                    'CMD_GET_BATTERY_INFO', 'CMD_GET_ACTIVE_SLOT', 'CMD_GET_SLOT_INFO',
                    'CMD_SET_ACTIVE_SLOT', 'CMD_GET_SLOT_TAG_NICK', 'CMD_SET_SLOT_TAG_NICK',
                    'CMD_MF0_NTAG_READ_EMU_PAGE_DATA', 'CMD_MF0_NTAG_WRITE_EMU_PAGE_DATA',
                    'CMD_MF0_NTAG_GET_VERSION_DATA', 'CMD_MF0_NTAG_SET_VERSION_DATA',
                    'CMD_GET_ALL_SLOT_NICKS', 'CMD_GET_ENABLED_SLOTS', 'CMD_SET_SLOT_TAG_TYPE',
                    'CMD_SET_SLOT_DATA_DEFAULT', 'CMD_SET_SLOT_ENABLE', 'CMD_DELETE_SLOT_INFO',
                    'CMD_SLOT_DATA_CONFIG_SAVE'
                ],
                // Helper functions
                'log': ['logToConsole'],
                'load': ['loadWasm', 'loadJS'],
                'wasm': ['wasmModules']
            };

            codeEditor = CodeMirror.fromTextArea(document.getElementById('codeEditor'), {
                mode: 'javascript',
                theme: 'monokai',
                lineNumbers: true,
                indentUnit: 4,
                tabSize: 4,
                indentWithTabs: false,
                lineWrapping: true,
                autoCloseBrackets: true,
                matchBrackets: true,
                styleActiveLine: true,
                foldGutter: true,
                gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
                extraKeys: {
                    'Ctrl-Enter': runEditorScript,
                    'Cmd-Enter': runEditorScript,
                    'Ctrl-Space': 'autocomplete',
                    'Cmd-/': 'toggleComment',
                    'Ctrl-/': 'toggleComment',
                    'Shift-Tab': (cm) => cm.execCommand('indentLess'),
                    'Tab': (cm) => {
                        if (cm.somethingSelected()) {
                            cm.execCommand('indentMore');
                        } else {
                            cm.replaceSelection('    ');
                        }
                    }
                },
                hintOptions: {
                    completeSingle: false,
                    hint: (cm) => {
                        const cursor = cm.getCursor();
                        const token = cm.getTokenAt(cursor);
                        const start = token.start;
                        const end = cursor.ch;
                        const line = cursor.line;
                        const currentWord = token.string;

                        // Get all available hints
                        const hints = [];

                        // Add Chameleon-specific hints
                        if (currentWord.startsWith('CMD_')) {
                            hints.push(...chameleonHints['CMD_']);
                        } else if (currentWord.startsWith('log')) {
                            hints.push(...chameleonHints['log']);
                        } else if (currentWord.startsWith('load')) {
                            hints.push(...chameleonHints['load']);
                        } else if (currentWord.startsWith('wasm')) {
                            hints.push(...chameleonHints['wasm']);
                        } else if (currentWord.startsWith('chameleon')) {
                            hints.push('chameleonUltra');
                        }

                        // Get JavaScript hints
                        const jsHints = CodeMirror.hint.javascript(cm) || { list: [] };
                        hints.push(...jsHints.list);

                        // Get word hints from the document
                        const wordHints = CodeMirror.hint.anyword(cm) || { list: [] };
                        hints.push(...wordHints.list);

                        // Filter and deduplicate
                        const filtered = [...new Set(hints)]
                            .filter(h => h.toLowerCase().includes(currentWord.toLowerCase()))
                            .sort();

                        return {
                            list: filtered.length > 0 ? filtered : jsHints.list,
                            from: CodeMirror.Pos(line, start),
                            to: CodeMirror.Pos(line, end)
                        };
                    }
                }
            });

            // Auto-trigger autocomplete on certain characters
            codeEditor.on('inputRead', (cm, change) => {
                if (change.text[0].match(/[a-zA-Z_]/)) {
                    cm.showHint();
                }
            });

            // Mark editor as initialized
            editorInitialized = true;

            // Load saved editor content (unless disabled or URL parameter present)
            const disableAutoRestore = localStorage.getItem('chameleonDisableAutoRestore') === 'true';

            // Don't auto-restore if:
            // 1. URL has script/load parameter (will be loaded later)
            // 2. Auto-restore is disabled
            // 3. No saved content exists
            if (!hasURLScript && !disableAutoRestore) {
                const savedContent = localStorage.getItem('chameleonEditorContent') || '';
                const savedName = localStorage.getItem('chameleonEditorName') || 'my-script.js';
                if (savedContent) {
                    codeEditor.setValue(savedContent);
                    document.getElementById('scriptName').value = savedName;
                    logToConsole('ℹ️  Restored previous session (click "📄 New" to start fresh)');
                }
            } else if (disableAutoRestore) {
                logToConsole('ℹ️  Auto-restore disabled');
            } else if (hasURLScript) {
                logToConsole('ℹ️  Loading script from URL...');
            }
        });

        // Tab switching
        function switchTab(tabName) {
            document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

            document.querySelector(`[onclick="switchTab('${tabName}')"]`).classList.add('active');
            document.getElementById(`${tabName}-tab`).classList.add('active');

            // Refresh content when switching tabs
            if (tabName === 'files') {
                refreshFileTree();
            } else if (tabName === 'extensions') {
                refreshExtensions();
            }
        }
        window.switchTab = switchTab;

        // File Explorer Functions
        async function refreshFileTree() {
            if (!fs) return;

            try {
                const tree = await fs.getTree();
                renderFileTree(tree);
            } catch (error) {
                logToConsole(`Error loading file tree: ${error.message}`, true);
            }
        }
        window.refreshFileTree = refreshFileTree;

        function renderFileTree(node, container = null, level = 0) {
            if (!container) {
                container = document.getElementById('fileTree');
                container.innerHTML = '';
            }

            if (level === 0) {
                // Root node
                const rootItem = createFileTreeItem(node, level);
                container.appendChild(rootItem);

                if (node.children && node.children.length > 0) {
                    const childContainer = document.createElement('div');
                    childContainer.className = 'file-tree-children';
                    node.children.forEach(child => renderFileTree(child, childContainer, level + 1));
                    container.appendChild(childContainer);
                }
            } else {
                const item = createFileTreeItem(node, level);
                container.appendChild(item);

                if (node.type === 'directory' && node.children && node.children.length > 0) {
                    const childContainer = document.createElement('div');
                    childContainer.className = 'file-tree-children';
                    node.children.forEach(child => renderFileTree(child, childContainer, level + 1));
                    container.appendChild(childContainer);
                }
            }
        }

        function createFileTreeItem(node, level) {
            const item = document.createElement('div');
            item.className = 'file-tree-item';
            if (node.type === 'directory') item.classList.add('directory');

            // Indent
            for (let i = 0; i < level; i++) {
                const indent = document.createElement('span');
                indent.className = 'file-tree-indent';
                item.appendChild(indent);
            }

            // Icon
            const icon = document.createElement('span');
            icon.className = 'icon';
            icon.textContent = node.type === 'directory' ? '📁' : '📄';
            item.appendChild(icon);

            // Name
            const name = document.createElement('span');
            name.className = 'name';
            name.textContent = node.name;
            item.appendChild(name);

            // Size (for files)
            if (node.type !== 'directory' && node.size !== undefined) {
                const size = document.createElement('span');
                size.className = 'size';
                size.textContent = formatFileSize(node.size);
                item.appendChild(size);
            }

            // Actions
            const actions = document.createElement('span');
            actions.className = 'actions';

            if (node.type !== 'directory') {
                // Only show Run button for .js files
                if (node.name.endsWith('.js')) {
                    const runBtn = document.createElement('button');
                    runBtn.className = 'action-btn';
                    runBtn.textContent = '▶';
                    runBtn.title = 'Run';
                    runBtn.onclick = (e) => {
                        e.stopPropagation();
                        runFileFromFS(node.path);
                    };
                    actions.appendChild(runBtn);
                }

                const editBtn = document.createElement('button');
                editBtn.className = 'action-btn';
                editBtn.textContent = '✏️';
                editBtn.title = 'Edit';
                editBtn.onclick = (e) => {
                    e.stopPropagation();
                    editFileFromFS(node.path);
                };
                actions.appendChild(editBtn);
            }

            const renameBtn = document.createElement('button');
            renameBtn.className = 'action-btn';
            renameBtn.textContent = '🏷️';
            renameBtn.title = 'Rename';
            renameBtn.onclick = (e) => {
                e.stopPropagation();
                renameFileInFS(node.path);
            };
            actions.appendChild(renameBtn);

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'action-btn';
            deleteBtn.textContent = '🗑️';
            deleteBtn.title = 'Delete';
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                deleteFileFromFS(node.path);
            };
            actions.appendChild(deleteBtn);

            item.appendChild(actions);

            // Click handler
            item.onclick = () => {
                document.querySelectorAll('.file-tree-item').forEach(el => el.classList.remove('selected'));
                item.classList.add('selected');
                currentSelectedFile = node.path;
            };

            // Double-click handler - open text files in editor
            if (node.type !== 'directory') {
                const textExtensions = ['.js', '.txt', '.md', '.json', '.html', '.css', '.xml', '.csv', '.log'];
                const isTextFile = textExtensions.some(ext => node.name.toLowerCase().endsWith(ext));

                if (isTextFile) {
                    item.ondblclick = (e) => {
                        e.stopPropagation();
                        editFileFromFS(node.path);
                    };
                }
            }

            // Drag and drop handlers
            item.draggable = true;
            item.dataset.path = node.path;
            item.dataset.isDirectory = node.type === 'directory';

            item.addEventListener('dragstart', (e) => {
                e.stopPropagation();
                item.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', node.path);
                e.dataTransfer.setData('application/x-vfs-path', node.path);
            });

            item.addEventListener('dragend', (e) => {
                item.classList.remove('dragging');
                // Remove drag-over class from all items
                document.querySelectorAll('.file-tree-item').forEach(el => el.classList.remove('drag-over'));
            });

            // Only directories can be drop targets
            if (node.type === 'directory') {
                item.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = 'move';
                    item.classList.add('drag-over');
                });

                item.addEventListener('dragleave', (e) => {
                    e.stopPropagation();
                    item.classList.remove('drag-over');
                });

                item.addEventListener('drop', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    item.classList.remove('drag-over');

                    const sourcePath = e.dataTransfer.getData('application/x-vfs-path') || e.dataTransfer.getData('text/plain');
                    const targetDir = node.path;

                    if (!sourcePath || sourcePath === targetDir) return;

                    // Don't allow moving a directory into itself or its children
                    if (targetDir.startsWith(sourcePath + '/')) {
                        logToConsole('❌ Cannot move a directory into itself', true);
                        return;
                    }

                    // Extract filename from source path
                    const fileName = sourcePath.substring(sourcePath.lastIndexOf('/') + 1);
                    const newPath = `${targetDir}/${fileName}`.replace('//', '/');

                    if (sourcePath === newPath) {
                        logToConsole('ℹ️  File is already in this location');
                        return;
                    }

                    try {
                        await fs.move(sourcePath, newPath);
                        logToConsole(`✓ Moved: ${sourcePath} → ${newPath}`);
                        await refreshFileTree();

                        // Update editor path if this file is currently being edited
                        if (codeEditor._currentVFSPath === sourcePath) {
                            codeEditor._currentVFSPath = newPath;
                        }
                    } catch (error) {
                        logToConsole(`❌ Error moving: ${error.message}`, true);
                    }
                });
            }

            return item;
        }

        function formatFileSize(bytes) {
            if (bytes < 1024) return bytes + ' B';
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
            return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        }

        // Modal Helper Functions
        function showModal(title, bodyHTML, buttons) {
            const modal = document.getElementById('genericModal');
            document.getElementById('modalTitle').textContent = title;
            document.getElementById('modalBody').innerHTML = bodyHTML;

            const footer = document.getElementById('modalFooter');
            footer.innerHTML = '';

            buttons.forEach(btn => {
                const button = document.createElement('button');
                button.textContent = btn.text;
                button.className = btn.className || 'btn-secondary';
                button.onclick = () => {
                    if (btn.onClick) btn.onClick();
                    closeGenericModal();
                };
                footer.appendChild(button);
            });

            modal.classList.add('active');

            // Focus first input if exists
            setTimeout(() => {
                const firstInput = modal.querySelector('input[type="text"]');
                if (firstInput) firstInput.focus();
            }, 100);
        }

        function closeGenericModal() {
            document.getElementById('genericModal').classList.remove('active');
        }
        window.closeGenericModal = closeGenericModal;

        // Close modal on background click
        document.getElementById('genericModal').addEventListener('click', (e) => {
            if (e.target.id === 'genericModal') {
                closeGenericModal();
            }
        });

        // Helper to get the selected directory (or default to root)
        function getSelectedDirectory() {
            if (!currentSelectedFile) return '/';

            // Check if selected item is a directory
            const selectedEl = document.querySelector('.file-tree-item.selected');
            if (selectedEl && selectedEl.dataset.isDirectory === 'true') {
                return currentSelectedFile;
            }

            // If it's a file, return its parent directory
            const lastSlash = currentSelectedFile.lastIndexOf('/');
            return lastSlash > 0 ? currentSelectedFile.substring(0, lastSlash) : '/';
        }

        async function uploadToFS() {
            const targetDir = getSelectedDirectory();

            // Store selected directory for the file input handler
            window._uploadTargetDir = targetDir;

            logToConsole(`📤 Upload target: ${targetDir}`);
            document.getElementById('fsFileInput').click();
        }
        window.uploadToFS = uploadToFS;

        document.getElementById('fsFileInput').addEventListener('change', async (e) => {
            const files = Array.from(e.target.files);
            const targetDir = window._uploadTargetDir || '/scripts';

            for (const file of files) {
                try {
                    const content = await file.text();
                    const path = `${targetDir}/${file.name}`.replace('//', '/');
                    await fs.writeFile(path, content);
                    logToConsole(`✓ Uploaded to VFS: ${path}`);
                } catch (error) {
                    logToConsole(`Error uploading ${file.name}: ${error.message}`, true);
                }
            }
            await refreshFileTree();
            e.target.value = ''; // Reset input
            delete window._uploadTargetDir;
        });

        async function createNewFile() {
            const targetDir = getSelectedDirectory();

            showModal('📄 Create New File', `
                <p>Location: <strong>${targetDir}</strong></p>
                <label>File Name:</label>
                <input type="text" id="newFileName" placeholder="my-script.js" value="">
            `, [
                {
                    text: 'Cancel',
                    className: 'btn-secondary'
                },
                {
                    text: 'Create',
                    className: 'btn-primary',
                    onClick: async () => {
                        const fileName = document.getElementById('newFileName').value.trim();
                        if (!fileName) {
                            logToConsole('❌ File name cannot be empty', true);
                            return;
                        }

                        try {
                            const path = `${targetDir}/${fileName}`.replace('//', '/');
                            await fs.writeFile(path, '// New file\n');
                            logToConsole(`✓ Created: ${path}`);
                            await refreshFileTree();
                        } catch (error) {
                            logToConsole(`Error creating file: ${error.message}`, true);
                        }
                    }
                }
            ]);
        }
        window.createNewFile = createNewFile;

        async function createNewFolder() {
            const targetDir = getSelectedDirectory();

            showModal('📁 Create New Folder', `
                <p>Location: <strong>${targetDir}</strong></p>
                <label>Folder Name:</label>
                <input type="text" id="newFolderName" placeholder="my-folder" value="">
            `, [
                {
                    text: 'Cancel',
                    className: 'btn-secondary'
                },
                {
                    text: 'Create',
                    className: 'btn-primary',
                    onClick: async () => {
                        const folderName = document.getElementById('newFolderName').value.trim();
                        if (!folderName) {
                            logToConsole('❌ Folder name cannot be empty', true);
                            return;
                        }

                        try {
                            const path = `${targetDir}/${folderName}`.replace('//', '/');
                            console.log('Creating folder at path:', path);

                            // Check if already exists
                            const exists = await fs.exists(path);
                            if (exists) {
                                logToConsole(`❌ Folder already exists: ${path}`, true);
                                return;
                            }

                            await fs.mkdir(path);
                            logToConsole(`✓ Created folder: ${path}`);
                            await refreshFileTree();
                        } catch (error) {
                            console.error('Folder creation error:', error);
                            logToConsole(`Error creating folder: ${error.message}`, true);
                        }
                    }
                }
            ]);
        }
        window.createNewFolder = createNewFolder;

        async function runFileFromFS(path) {
            try {
                logToConsole(`▶ Running: ${path}`);
                const content = await fs.readFile(path);
                const scriptFunc = new Function(content);
                const result = scriptFunc.call(window);

                if (result && typeof result.then === 'function') {
                    await result;
                }
            } catch (error) {
                logToConsole(`Error running ${path}: ${error.message}`, true);
            }
        }

        async function editFileFromFS(path) {
            try {
                const content = await fs.readFile(path);
                codeEditor.setValue(content);
                document.getElementById('scriptName').value = path.substring(path.lastIndexOf('/') + 1);
                switchTab('editor');

                // Store the path so we can save back to VFS
                codeEditor._currentVFSPath = path;

                // Refresh CodeMirror to display content immediately
                setTimeout(() => codeEditor.refresh(), 10);

                logToConsole(`✏️ Editing: ${path}`);
            } catch (error) {
                logToConsole(`Error loading file: ${error.message}`, true);
            }
        }

        async function deleteFileFromFS(path) {
            // Check if it's a directory
            const isDir = await new Promise((resolve) => {
                const transaction = fs.db.transaction(['directories'], 'readonly');
                const store = transaction.objectStore('directories');
                const request = store.get(path);
                request.onsuccess = () => resolve(!!request.result);
                request.onerror = () => resolve(false);
            });

            const type = isDir ? 'folder' : 'file';
            const icon = isDir ? '📁' : '📄';
            const warningMsg = isDir ? ' and all its contents' : '';

            showModal(`${icon} Delete ${type.charAt(0).toUpperCase() + type.slice(1)}`, `
                <p class="warning">⚠️ Are you sure you want to delete this ${type}${warningMsg}?</p>
                <p><strong>${path}</strong></p>
                <p class="error">This action cannot be undone.</p>
            `, [
                {
                    text: 'Cancel',
                    className: 'btn-secondary'
                },
                {
                    text: 'Delete',
                    className: 'btn-danger',
                    onClick: async () => {
                        try {
                            await fs.remove(path);
                            logToConsole(`✓ Deleted ${type}: ${path}`);
                            await refreshFileTree();
                        } catch (error) {
                            logToConsole(`Error deleting ${type}: ${error.message}`, true);
                        }
                    }
                }
            ]);
        }

        async function renameFileInFS(path) {
            const currentName = path.substring(path.lastIndexOf('/') + 1);
            const currentDir = path.substring(0, path.lastIndexOf('/')) || '/';

            // Ask for new name
            const newName = prompt(`Rename:\n\nCurrent: ${currentName}\n\nEnter new name:`, currentName);
            if (!newName || newName === currentName) return;

            const newPath = `${currentDir}/${newName}`.replace('//', '/');

            try {
                await fs.move(path, newPath);
                logToConsole(`✓ Renamed: ${currentName} → ${newName}`);
                await refreshFileTree();

                // Update editor path if this file is currently being edited
                if (codeEditor._currentVFSPath === path) {
                    codeEditor._currentVFSPath = newPath;
                    document.getElementById('scriptName').value = newName;
                }
            } catch (error) {
                logToConsole(`Error renaming: ${error.message}`, true);
            }
        }
        window.renameFileInFS = renameFileInFS;

        // Run script from editor
        async function runEditorScript() {
            const code = codeEditor.getValue();
            if (!code.trim()) {
                logToConsole('❌ Editor is empty', true);
                return;
            }

            try {
                logToConsole(`▶ Running editor script...`);
                const scriptFunc = new Function(code);
                const result = scriptFunc.call(window);

                // Handle async functions
                if (result && typeof result.then === 'function') {
                    await result;
                }
            } catch (error) {
                logToConsole(`❌ Error: ${error.message}`, true);
                console.error(error);
            }
        }

        // Save editor script to uploaded scripts
        async function saveEditorScript() {
            const code = codeEditor.getValue();
            const name = document.getElementById('scriptName').value.trim();

            if (!code.trim()) {
                logToConsole('❌ Editor is empty', true);
                return;
            }

            if (!name) {
                logToConsole('❌ Please enter a script name', true);
                return;
            }

            // If editing a VFS file, save back to VFS
            if (codeEditor._currentVFSPath) {
                try {
                    const oldPath = codeEditor._currentVFSPath;
                    const oldName = oldPath.substring(oldPath.lastIndexOf('/') + 1);

                    // Check if name was changed
                    if (name !== oldName) {
                        // Name changed - move/rename the file
                        const dir = oldPath.substring(0, oldPath.lastIndexOf('/')) || '/';
                        const newPath = `${dir}/${name}`.replace('//', '/');

                        // Write new file with updated content
                        await fs.writeFile(newPath, code);

                        // Delete old file if different path
                        if (oldPath !== newPath) {
                            await fs.deleteFile(oldPath);
                        }

                        // Update current path
                        codeEditor._currentVFSPath = newPath;
                        logToConsole(`✓ Saved and renamed: ${oldName} → ${name}`);
                    } else {
                        // Just save with same name
                        await fs.writeFile(oldPath, code);
                        logToConsole(`✓ Saved to VFS: ${oldPath}`);
                    }

                    await refreshFileTree();
                    return;
                } catch (error) {
                    logToConsole(`Error saving to VFS: ${error.message}`, true);
                    return;
                }
            }

            // Save as new file to VFS
            try {
                // Try /scripts folder first, fall back to root if it doesn't exist
                let targetDir = '/scripts';
                const scriptsExists = await fs.exists('/scripts');
                if (!scriptsExists) {
                    targetDir = '/';
                }

                const path = `${targetDir}/${name}`.replace('//', '/');
                await fs.writeFile(path, code);
                codeEditor._currentVFSPath = path;

                logToConsole(`✓ Saved to VFS: ${path}`);
                await refreshFileTree();
            } catch (error) {
                logToConsole(`Error saving to VFS: ${error.message}`, true);
            }
        }

        // Clear editor
        function clearEditor() {
            const currentContent = codeEditor.getValue().trim();
            const currentName = document.getElementById('scriptName').value;

            if (!currentContent) {
                logToConsole('Editor is already empty');
                return;
            }

            showModal('🗑️ Clear Editor', `
                <p class="warning">⚠️ Are you sure you want to clear the editor?</p>
                <p><strong>${currentName}</strong></p>
                <p>Content: ${currentContent.length} characters</p>
                <p class="error">This action cannot be undone. Unsaved changes will be lost.</p>
            `, [
                {
                    text: 'Cancel',
                    className: 'btn-secondary'
                },
                {
                    text: 'Clear',
                    className: 'btn-danger',
                    onClick: () => {
                        codeEditor.setValue('');
                        document.getElementById('scriptName').value = 'my-script.js';
                        localStorage.removeItem('chameleonEditorContent');
                        localStorage.removeItem('chameleonEditorName');
                        delete codeEditor._currentVFSPath;
                        logToConsole('✓ Editor cleared');
                    }
                }
            ]);
        }

        // Start new script (clears editor without confirmation)
        function newScript() {
            const template = `/**
 * Script Name
 * @author Your Name
 *
 * Description of what this script does
 */

(async function() {
    logToConsole('Starting script...');

    // Your code here

    logToConsole('✓ Script completed');
})();
`;
            codeEditor.setValue(template);
            document.getElementById('scriptName').value = 'my-script.js';
            localStorage.removeItem('chameleonEditorContent');
            localStorage.removeItem('chameleonEditorName');
            delete codeEditor._currentVFSPath;
            logToConsole('📄 New script created from template');
        }

        // Toggle auto-restore feature
        function toggleAutoRestore() {
            const current = localStorage.getItem('chameleonDisableAutoRestore') === 'true';
            localStorage.setItem('chameleonDisableAutoRestore', (!current).toString());
            logToConsole(`Auto-restore ${current ? 'enabled' : 'disabled'}`);
        }

        // Format code with Prettier
        function formatCode() {
            try {
                const code = codeEditor.getValue();
                const formatted = prettier.format(code, {
                    parser: 'babel',
                    plugins: prettierPlugins,
                    semi: true,
                    singleQuote: true,
                    tabWidth: 4,
                    trailingComma: 'es5',
                    arrowParens: 'always',
                });
                codeEditor.setValue(formatted);
                logToConsole('✨ Code formatted');
            } catch (error) {
                logToConsole(`❌ Format error: ${error.message}`, true);
            }
        }

        // Load script templates
        function loadTemplate(templateName) {
            let template = '';

            if (templateName === 'wasm') {
                template = `// Load and use WASM crypto libraries
(async function() {
    logToConsole('📚 Loading WASM module...');

    // Load a WASM module (e.g., mfkey32)
    if (!wasmModules.mfkey32) {
        await loadWasm('mfkey32');
    }

    const module = wasmModules.mfkey32;
    logToConsole('✓ WASM module loaded!');

    // Available WASM modules:
    // - mfkey32, mfkey64: Mifare Classic key recovery
    // - nested, darkside, hardnested: Various attacks
    // - staticnested: Static nested attack

    // Example: Access WASM functions
    logToConsole('Module provides: ccall, cwrap, _malloc, _free, HEAPU8');

    // To use with Chameleon data:
    // 1. Collect nonces from device
    // 2. Pass to WASM function
    // 3. Get recovered keys

    return module;
})();`;
            } else if (templateName === 'battery') {
                template = `// Get battery status
(async function() {
    if (!chameleonUltra?.device?.gatt?.connected) {
        logToConsole('❌ Device not connected!', true);
        return;
    }

    const response = await chameleonUltra.cmd(CMD_GET_BATTERY_INFO);

    if (response.status === 0x68) {
        const voltage = (response.data[0] << 8) | response.data[1];
        const percentage = response.data[2];

        logToConsole(\`🔋 Battery: \${percentage}% (\${voltage}mV)\`);
        return { voltage, percentage };
    }
})();`;
            } else if (templateName === 'slot') {
                template = `// Read slot data
(async function() {
    if (!chameleonUltra?.device?.gatt?.connected) {
        logToConsole('❌ Device not connected!', true);
        return;
    }

    const slotNum = 1; // Change this to read different slots

    // Get all slot info
    const slotInfo = await chameleonUltra.cmd(CMD_GET_SLOT_INFO);

    if (slotInfo.status === 0x68) {
        const offset = (slotNum - 1) * 4;
        const hfType = (slotInfo.data[offset] << 8) | slotInfo.data[offset + 1];
        const lfType = (slotInfo.data[offset + 2] << 8) | slotInfo.data[offset + 3];

        logToConsole(\`Slot \${slotNum}: HF=\${hfType}, LF=\${lfType}\`);

        // Read NTAG data if HF tag
        if (hfType >= 1100 && hfType <= 1108) {
            const pages = await chameleonUltra.cmd(CMD_MF0_NTAG_READ_EMU_PAGE_DATA, new Uint8Array([0, 10]));
            if (pages.status === 0x68) {
                const uid = Array.from(pages.data.slice(0, 9))
                    .map(b => b.toString(16).padStart(2, '0').toUpperCase())
                    .join(' ');
                logToConsole(\`UID: \${uid}\`);
            }
        }
    }
})();`;
            }

            codeEditor.setValue(template);
            logToConsole(`📋 Loaded ${templateName} template`);
        }

        // Auto-save editor content periodically (only if content exists)
        setInterval(() => {
            if (codeEditor) {
                const content = codeEditor.getValue();
                const name = document.getElementById('scriptName').value;

                // Only auto-save if there's actual content
                if (content.trim()) {
                    localStorage.setItem('chameleonEditorContent', content);
                    localStorage.setItem('chameleonEditorName', name);
                }
            }
        }, 5000);

        // Check if script was shared via URL
        function loadScriptFromURL() {
            const urlParams = new URLSearchParams(window.location.search);
            const sharedScript = urlParams.get('script');
            const loadFile = urlParams.get('load'); // Support loading external files

            if (sharedScript) {
                try {
                    const decoded = atob(sharedScript);
                    const scriptData = JSON.parse(decoded);

                    // Load into editor
                    if (codeEditor) {
                        codeEditor.setValue(scriptData.code);
                        document.getElementById('scriptName').value = scriptData.name || 'shared-script.js';
                        logToConsole(`📥 Loaded shared script: ${scriptData.name || 'unnamed'}`);
                        switchTab('editor');
                    }

                    // Clear URL parameters
                    window.history.replaceState({}, document.title, window.location.pathname);
                } catch (error) {
                    logToConsole('❌ Failed to load shared script', true);
                    console.error('Script load error:', error);
                }
            } else if (loadFile) {
                // Load external JavaScript file
                loadExternalScript(loadFile);
                // Clear URL parameters
                window.history.replaceState({}, document.title, window.location.pathname);
            }
        }

        // Load external JavaScript file into editor
        async function loadExternalScript(filePath) {
            try {
                logToConsole(`📥 Loading external script: ${filePath}...`);

                const response = await fetch(filePath);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const code = await response.text();
                const fileName = filePath.split('/').pop() || 'loaded-script.js';

                if (codeEditor) {
                    codeEditor.setValue(code);
                    document.getElementById('scriptName').value = fileName;
                    logToConsole(`✓ Loaded: ${fileName}`);
                    switchTab('editor');
                } else {
                    // If editor not ready yet, store for later
                    setTimeout(() => loadExternalScript(filePath), 100);
                }
            } catch (error) {
                logToConsole(`❌ Failed to load script: ${error.message}`, true);
                console.error('External script load error:', error);
            }
        }

        // Share script via URL
        function shareViaURL() {
            const code = codeEditor.getValue();
            const name = document.getElementById('scriptName').value;

            if (!code.trim()) {
                logToConsole('❌ Editor is empty', true);
                return;
            }

            const scriptData = { name, code };
            const encoded = btoa(JSON.stringify(scriptData));
            const shareURL = `${window.location.origin}${window.location.pathname}?script=${encoded}`;

            // Copy to clipboard
            navigator.clipboard.writeText(shareURL).then(() => {
                logToConsole('✓ Share link copied to clipboard!');
                logToConsole(`📋 ${shareURL.substring(0, 80)}...`);
            }).catch(() => {
                // Fallback: show URL for manual copy
                logToConsole('📋 Share URL:');
                logToConsole(shareURL);
            });
        }

        // Share via QR Code
        function shareViaQR() {
            const code = codeEditor.getValue();
            const name = document.getElementById('scriptName').value;

            if (!code.trim()) {
                logToConsole('❌ Editor is empty', true);
                return;
            }

            const scriptData = { name, code };
            const encoded = btoa(JSON.stringify(scriptData));
            const shareURL = `${window.location.origin}${window.location.pathname}?script=${encoded}`;

            // Clear previous QR code
            const qrDiv = document.getElementById('qrcode');
            qrDiv.innerHTML = '';

            // Generate QR code
            new QRCode(qrDiv, {
                text: shareURL,
                width: 256,
                height: 256,
                colorDark: '#000000',
                colorLight: '#ffffff',
            });

            // Show modal
            document.getElementById('qrModal').style.display = 'block';
            logToConsole('📱 QR code generated');
        }

        function closeQRModal() {
            document.getElementById('qrModal').style.display = 'none';
        }

        // Download script as file
        function downloadScript() {
            const code = codeEditor.getValue();
            const name = document.getElementById('scriptName').value;

            if (!code.trim()) {
                logToConsole('❌ Editor is empty', true);
                return;
            }

            const blob = new Blob([code], { type: 'application/javascript' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = name;
            a.click();
            URL.revokeObjectURL(url);

            logToConsole(`✓ Downloaded: ${name}`);
        }

        // Share to GitHub Gist
        async function shareToGist() {
            const code = codeEditor.getValue();
            const name = document.getElementById('scriptName').value;

            if (!code.trim()) {
                logToConsole('❌ Editor is empty', true);
                return;
            }

            try {
                logToConsole('📤 Creating GitHub Gist...');

                const gistData = {
                    description: `Chameleon Ultra Script: ${name}`,
                    public: true,
                    files: {
                        [name]: {
                            content: code
                        }
                    }
                };

                const response = await fetch('https://api.github.com/gists', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(gistData)
                });

                if (response.ok) {
                    const result = await response.json();
                    const gistURL = result.html_url;

                    // Copy to clipboard
                    await navigator.clipboard.writeText(gistURL);
                    logToConsole('✓ Gist created and URL copied!');
                    logToConsole(`🐙 ${gistURL}`);
                } else {
                    throw new Error(`HTTP ${response.status}`);
                }
            } catch (error) {
                logToConsole(`❌ Failed to create Gist: ${error.message}`, true);
                logToConsole('ℹ️  Note: Anonymous Gists have rate limits');
            }
        }

        // Load script from uploaded file
        function loadScriptFromFile(scriptName) {
            if (uploadedScripts[scriptName]) {
                codeEditor.setValue(uploadedScripts[scriptName].content);
                document.getElementById('scriptName').value = scriptName;
                switchTab('editor');
                logToConsole(`📂 Loaded: ${scriptName}`);
            }
        }

        // Update scripts list to add "Edit" button
        const originalUpdateScriptsList = updateScriptsList;
        updateScriptsList = function() {
            const listEl = document.getElementById('scriptsList');
            listEl.innerHTML = '';

            const scripts = Object.values(uploadedScripts);
            if (scripts.length === 0) {
                listEl.innerHTML = '<li style="border: none; background: none;">No scripts uploaded</li>';
                return;
            }

            scripts.sort((a, b) => a.name.localeCompare(b.name));

            scripts.forEach(script => {
                const li = document.createElement('li');

                const nameSpan = document.createElement('span');
                nameSpan.className = 'script-name';
                nameSpan.textContent = script.name;

                const editBtn = document.createElement('button');
                editBtn.textContent = 'Edit';
                editBtn.className = 'small';
                editBtn.onclick = () => loadScriptFromFile(script.name);

                const runBtn = document.createElement('button');
                runBtn.textContent = 'Run';
                runBtn.className = 'small';
                runBtn.onclick = () => executeScript(script.name);

                const deleteBtn = document.createElement('button');
                deleteBtn.textContent = 'Delete';
                deleteBtn.className = 'small danger';
                deleteBtn.onclick = () => deleteScript(script.name);

                li.appendChild(nameSpan);
                li.appendChild(editBtn);
                li.appendChild(runBtn);
                li.appendChild(deleteBtn);
                listEl.appendChild(li);
            });
        };

        // Initialize filesystem and load scripts on page load
        initFileSystem();
        loadUploadedScripts();

        // Load shared script from URL if present (wait for editor to be ready)
        function waitForEditorAndLoadURL() {
            if (editorInitialized) {
                loadScriptFromURL();
            } else {
                setTimeout(waitForEditorAndLoadURL, 100);
            }
        }
        waitForEditorAndLoadURL();

        // Event hooks for extensions
        const eventHooks = {
            onDeviceConnected: [],
            onDeviceDisconnected: [],
            onSlotChanged: []
        };

        // Extension API
        window.ChameleonAPI = {
            // Register a new command
            registerCommand: function(name, description, handler) {
                const cmdName = name.toLowerCase();
                commands[cmdName] = {
                    description: description,
                    handler: handler
                };
                console.log('Registered command:', cmdName, 'Total commands:', Object.keys(commands));
                logToConsole(`✓ Extension registered command: ${name}`);
            },

            // Register event hooks
            on: function(event, callback) {
                if (eventHooks[event]) {
                    eventHooks[event].push(callback);
                    logToConsole(`✓ Extension registered hook: ${event}`);
                } else {
                    logToConsole(`Unknown event: ${event}. Available: onDeviceConnected, onDeviceDisconnected, onSlotChanged`, true);
                }
            },

            // Trigger event (internal use)
            _trigger: function(event, ...args) {
                if (eventHooks[event]) {
                    eventHooks[event].forEach(callback => {
                        try {
                            callback(...args);
                        } catch (err) {
                            console.error(`Error in ${event} hook:`, err);
                        }
                    });
                }
            },

            // Access to core functions
            logToConsole: logToConsole,
            fs: null, // Will be set after fs is initialized
            chameleonUltra: null, // Will be set after device connection

            // Access to UI elements
            switchTab: switchTab,
            refreshFileTree: refreshFileTree,

            // Utility functions
            getTagTypeName: getTagTypeName,
            currentDir: () => currentDir,

            // Constants
            CMD_GET_BATTERY_INFO: CMD_GET_BATTERY_INFO,
            CMD_GET_ACTIVE_SLOT: CMD_GET_ACTIVE_SLOT,
            CMD_SET_ACTIVE_SLOT: CMD_SET_ACTIVE_SLOT,
            CMD_GET_SLOT_INFO: CMD_GET_SLOT_INFO,
            CMD_GET_SLOT_TAG_NICK: CMD_GET_SLOT_TAG_NICK
        };

        // Load extensions from /extensions folder
        // Extension state management
        const extensionState = {
            disabled: new Set() // Store disabled extension paths
        };

        // Load disabled extensions list from localStorage
        function loadExtensionState() {
            try {
                const saved = localStorage.getItem('disabledExtensions');
                if (saved) {
                    extensionState.disabled = new Set(JSON.parse(saved));
                }
            } catch (err) {
                console.error('Error loading extension state:', err);
            }
        }

        // Save disabled extensions list to localStorage
        function saveExtensionState() {
            try {
                localStorage.setItem('disabledExtensions', JSON.stringify([...extensionState.disabled]));
            } catch (err) {
                console.error('Error saving extension state:', err);
            }
        }

        async function loadExtensions() {
            try {
                loadExtensionState();
                logToConsole('Loading extensions...');
                const extensions = await fs.listFiles('/extensions');

                if (extensions.length === 0) {
                    logToConsole('No extensions found');
                    return;
                }

                // Update API references
                window.ChameleonAPI.fs = fs;
                window.ChameleonAPI.chameleonUltra = chameleonUltra;

                for (const ext of extensions) {
                    if (ext.path.endsWith('.js')) {
                        // Skip if disabled
                        if (extensionState.disabled.has(ext.path)) {
                            logToConsole(`⊘ Skipping disabled extension: ${ext.path}`);
                            continue;
                        }

                        try {
                            logToConsole(`Loading extension: ${ext.path}`);

                            // Read the file content
                            const code = await fs.readFile(ext.path);

                            // Execute extension in a context with access to API
                            const extensionFunc = new Function('API', code);
                            await extensionFunc.call(window, window.ChameleonAPI);

                            logToConsole(`✓ Loaded extension: ${ext.path}`);
                        } catch (err) {
                            console.error('Extension error:', err);
                            logToConsole(`Error loading extension ${ext.path}: ${err.message}`, true);
                        }
                    }
                }
            } catch (error) {
                logToConsole(`Error loading extensions: ${error.message}`, true);
            }
        }

        // Extension Manager UI
        async function refreshExtensions() {
            try {
                const extensions = await fs.listFiles('/extensions');
                const extensionsList = document.getElementById('extensionsList');

                if (extensions.length === 0) {
                    extensionsList.innerHTML = '<div style="padding: 20px; text-align: center; color: #888;">No extensions found in /extensions folder</div>';
                    return;
                }

                extensionsList.innerHTML = '';

                for (const ext of extensions) {
                    if (!ext.path.endsWith('.js')) continue;

                    const isEnabled = !extensionState.disabled.has(ext.path);
                    const item = document.createElement('div');
                    item.className = 'extension-item';

                    // Toggle switch
                    const toggle = document.createElement('button');
                    toggle.className = `extension-toggle ${isEnabled ? 'enabled' : ''}`;
                    toggle.onclick = () => toggleExtension(ext.path);

                    // Extension info
                    const info = document.createElement('div');
                    info.className = 'extension-info';

                    const name = document.createElement('div');
                    name.className = 'extension-name';
                    name.textContent = ext.name.replace('.js', '');

                    const path = document.createElement('div');
                    path.className = 'extension-path';
                    path.textContent = ext.path;

                    info.appendChild(name);
                    info.appendChild(path);

                    // Status badge
                    const status = document.createElement('div');
                    status.className = `extension-status ${isEnabled ? 'enabled' : 'disabled'}`;
                    status.textContent = isEnabled ? 'Enabled' : 'Disabled';

                    // Action buttons
                    const actions = document.createElement('div');
                    actions.className = 'extension-actions';

                    const editBtn = document.createElement('button');
                    editBtn.textContent = '✏️ Edit';
                    editBtn.onclick = () => editFileFromFS(ext.path);

                    const deleteBtn = document.createElement('button');
                    deleteBtn.textContent = '🗑️ Delete';
                    deleteBtn.onclick = () => deleteFileFromFS(ext.path);

                    actions.appendChild(editBtn);
                    actions.appendChild(deleteBtn);

                    item.appendChild(toggle);
                    item.appendChild(info);
                    item.appendChild(status);
                    item.appendChild(actions);

                    extensionsList.appendChild(item);
                }
            } catch (err) {
                console.error('Error refreshing extensions:', err);
            }
        }

        async function toggleExtension(path) {
            if (extensionState.disabled.has(path)) {
                extensionState.disabled.delete(path);
            } else {
                extensionState.disabled.add(path);
            }
            saveExtensionState();
            await refreshExtensions();
            logToConsole(`Extension ${path} ${extensionState.disabled.has(path) ? 'disabled' : 'enabled'}. Reload to apply changes.`);
        }

        async function reloadAllExtensions() {
            logToConsole('Reloading all extensions...');
            // Clear registered extension commands
            const builtInCommands = ['help', 'clear'];
            Object.keys(commands).forEach(cmd => {
                if (!builtInCommands.includes(cmd)) {
                    delete commands[cmd];
                }
            });
            // Clear event hooks
            Object.keys(eventHooks).forEach(event => {
                eventHooks[event] = [];
            });
            // Reload extensions
            await loadExtensions();
            await refreshExtensions();
            logToConsole('✓ Extensions reloaded');
        }

        // Make functions global for HTML onclick
        window.refreshExtensions = refreshExtensions;
        window.reloadAllExtensions = reloadAllExtensions;

        // Register built-in commands
        commands['help'] = {
            description: 'Show available commands',
            handler: () => {
                    logToConsole('Available commands:');
                    logToConsole('');
                    logToConsole('  hw connect          - Connect to Chameleon Ultra via BLE');
                    logToConsole('  hw disconnect       - Disconnect from device');
                    logToConsole('  hw battery          - Show battery level');
                    logToConsole('  hw slot list        - List available slots');
                    logToConsole('  hw slot info        - Show current slot number');
                    logToConsole('  hw slot details [n] - Show detailed info for slot N (or current)');
                    logToConsole('  hw slot change <n>  - Change to slot N (1-8)');
                    logToConsole('');
                    logToConsole('  Shell commands:');
                    logToConsole('  ls [path]           - List files and directories');
                    logToConsole('  cd <dir>            - Change directory (supports .., /, relative paths)');
                    logToConsole('  pwd                 - Print working directory');
                    logToConsole('  cat <file>          - Display file contents');
                    logToConsole('  mkdir <dir>         - Create directory');
                    logToConsole('  touch <file>        - Create empty file');
                    logToConsole('  rm <path>           - Delete file or directory (recursive)');
                    logToConsole('  rmdir <dir>         - Delete directory (alias for rm)');
                    logToConsole('');
                    logToConsole('  Filesystem (explicit):');
                    logToConsole('  fs ls [path]        - List files in directory');
                    logToConsole('  fs cat <file>       - Display file contents');
                    logToConsole('  fs rm <file>        - Delete file');
                    logToConsole('');
                    logToConsole('  clear               - Clear console');
                    logToConsole('  reset               - Reset filesystem (deletes all files)');
                    logToConsole('  help                - Show this help');

                    // Show extension commands
                    const extensionCommands = Object.keys(commands).filter(cmd =>
                        !['help', 'clear', 'reset'].includes(cmd)
                    );
                    if (extensionCommands.length > 0) {
                        logToConsole('');
                        logToConsole('  Extension commands:');
                        extensionCommands.forEach(cmd => {
                            const desc = commands[cmd].description || 'No description';
                            logToConsole(`  ${cmd.padEnd(20)} - ${desc}`);
                        });
                    }
            }
        };

        commands['clear'] = {
            description: 'Clear console',
            handler: () => clearConsole()
        };

        commands['reset'] = {
            description: 'Reset filesystem (WARNING: deletes all files)',
            handler: async () => {
                showModal('⚠️ Reset Filesystem', `
                    <div style="padding: 10px 0;">
                        <p style="color: #f87171; font-weight: bold; margin-bottom: 15px;">
                            ⚠️ WARNING: This action cannot be undone!
                        </p>
                        <p style="margin-bottom: 10px;">
                            This will permanently delete:
                        </p>
                        <ul style="margin-left: 20px; margin-bottom: 15px; color: #d4d4d4;">
                            <li>All files in the virtual filesystem</li>
                            <li>All folders and their contents</li>
                            <li>All uploaded scripts and data</li>
                            <li>All extensions (they will need to be re-uploaded)</li>
                        </ul>
                        <p style="color: #facc15;">
                            The filesystem will be reset to default with empty /helpers, /scripts, /data, and /extensions folders.
                        </p>
                    </div>
                `, [
                    {
                        text: 'Cancel',
                        className: 'btn-secondary'
                    },
                    {
                        text: '🗑️ Reset Filesystem',
                        className: 'danger',
                        onClick: async () => {
                            try {
                                logToConsole('Resetting filesystem...');

                                // Close and delete the database
                                if (fs && fs.db) {
                                    fs.db.close();
                                }

                                const deleteRequest = indexedDB.deleteDatabase('ChameleonFS');

                                deleteRequest.onsuccess = async () => {
                                    logToConsole('✓ Filesystem deleted');
                                    logToConsole('Reinitializing...');

                                    // Reinitialize filesystem
                                    await initFileSystem();

                                    logToConsole('✓ Filesystem reset complete');
                                };

                                deleteRequest.onerror = (event) => {
                                    logToConsole('Error resetting filesystem: ' + event.target.error, true);
                                };

                                deleteRequest.onblocked = () => {
                                    logToConsole('Reset blocked - close all other tabs using this app', true);
                                };
                            } catch (error) {
                                logToConsole(`Error resetting filesystem: ${error.message}`, true);
                            }
                        }
                    }
                ]);
            }
        };

        // Current working directory for shell commands
        let currentDir = '/';

        async function parseCommand(cmdStr) {
            if (!cmdStr) return;

            // Parse command with support for quoted strings
            const argv = [];
            let current = '';
            let inQuotes = false;
            let quoteChar = '';

            for (let i = 0; i < cmdStr.length; i++) {
                const char = cmdStr[i];

                if ((char === '"' || char === "'") && !inQuotes) {
                    inQuotes = true;
                    quoteChar = char;
                } else if (char === quoteChar && inQuotes) {
                    inQuotes = false;
                    quoteChar = '';
                } else if (char === ' ' && !inQuotes) {
                    if (current) {
                        argv.push(current);
                        current = '';
                    }
                } else {
                    current += char;
                }
            }
            if (current) argv.push(current);

            const cmd = argv[0] ? argv[0].toLowerCase() : '';

            console.log('Parsing command:', cmd, 'Args:', argv.slice(1));

            // Check registered commands first (includes extensions)
            if (commands[cmd]) {
                await commands[cmd].handler(argv.slice(1));
                return;
            }

            // Shell command aliases
            if (cmd === 'ls') {
                const path = argv[1] ? (argv[1].startsWith('/') ? argv[1] : `${currentDir}/${argv[1]}`.replace('//', '/')) : currentDir;

                // List directories
                const dirs = await fs.listDirectories();
                const dirsInPath = dirs.filter(d => {
                    if (path === '/') {
                        return !d.path.includes('/', 1);
                    }
                    return d.path.startsWith(path + '/') && !d.path.slice(path.length + 1).includes('/');
                });

                // List files
                const files = await fs.listFiles(path);

                if (dirsInPath.length === 0 && files.length === 0) {
                    logToConsole('(empty directory)');
                } else {
                    for (const dir of dirsInPath) {
                        logToConsole(`  📁 ${dir.path.split('/').pop()}/`);
                    }
                    for (const file of files) {
                        const fileName = file.path.split('/').pop();
                        const size = file.content.length;
                        logToConsole(`  📄 ${fileName.padEnd(30)} ${size} bytes`);
                    }
                }
                return;
            }

            if (cmd === 'cd') {
                const targetPath = argv[1] || '/';
                let newPath;

                if (targetPath === '/') {
                    newPath = '/';
                } else if (targetPath === '..') {
                    if (currentDir === '/') {
                        newPath = '/';
                    } else {
                        newPath = currentDir.substring(0, currentDir.lastIndexOf('/')) || '/';
                    }
                } else if (targetPath.startsWith('/')) {
                    newPath = targetPath;
                } else {
                    newPath = `${currentDir}/${targetPath}`.replace('//', '/');
                }

                // Check if directory exists
                const dirs = await fs.listDirectories();
                if (newPath === '/' || dirs.some(d => d.path === newPath)) {
                    currentDir = newPath;
                    logToConsole(`Current directory: ${currentDir}`);
                } else {
                    logToConsole(`Directory not found: ${newPath}`, true);
                }
                return;
            }

            if (cmd === 'cat') {
                if (!argv[1]) {
                    logToConsole('Usage: cat <file>');
                    return;
                }
                const filePath = argv[1].startsWith('/') ? argv[1] : `${currentDir}/${argv[1]}`.replace('//', '/');
                try {
                    const content = await fs.readFile(filePath);
                    logToConsole(content);
                } catch (err) {
                    logToConsole(`Error: ${err.message}`, true);
                }
                return;
            }

            if (cmd === 'pwd') {
                logToConsole(currentDir);
                return;
            }

            if (cmd === 'rm' || cmd === 'rmdir') {
                if (!argv[1]) {
                    logToConsole('Usage: rm <file|directory>');
                    return;
                }
                // Skip flags like -r, -rf
                const targetArg = argv.find(arg => !arg.startsWith('-'));
                if (!targetArg) {
                    logToConsole('Usage: rm <file|directory>');
                    return;
                }
                const filePath = targetArg.startsWith('/') ? targetArg : `${currentDir}/${targetArg}`.replace('//', '/');
                try {
                    await fs.remove(filePath);
                    logToConsole(`✓ Deleted: ${filePath}`);
                    await refreshFileTree();
                } catch (err) {
                    logToConsole(`Error: ${err.message}`, true);
                }
                return;
            }

            if (cmd === 'mkdir') {
                if (!argv[1]) {
                    logToConsole('Usage: mkdir <directory>');
                    return;
                }
                const dirPath = argv[1].startsWith('/') ? argv[1] : `${currentDir}/${argv[1]}`.replace('//', '/');
                try {
                    await fs.mkdir(dirPath);
                    logToConsole(`✓ Created directory: ${dirPath}`);
                    await refreshFileTree();
                } catch (err) {
                    logToConsole(`Error: ${err.message}`, true);
                }
                return;
            }

            if (cmd === 'touch') {
                if (!argv[1]) {
                    logToConsole('Usage: touch <file>');
                    return;
                }
                const filePath = argv[1].startsWith('/') ? argv[1] : `${currentDir}/${argv[1]}`.replace('//', '/');
                try {
                    // Check if file exists
                    const exists = await fs.exists(filePath);
                    if (!exists) {
                        await fs.writeFile(filePath, '');
                        logToConsole(`✓ Created file: ${filePath}`);
                        await refreshFileTree();
                    } else {
                        logToConsole(`File already exists: ${filePath}`);
                    }
                } catch (err) {
                    logToConsole(`Error: ${err.message}`, true);
                }
                return;
            }

            // Hardware commands (hw)
            if (cmd === 'hw') {
                if (!argv[1]) {
                    logToConsole('Usage: hw <subcommand>');
                    logToConsole('Try: hw connect, hw disconnect, hw battery, hw slot');
                    return;
                }

                const subcmd = argv[1].toLowerCase();

                if (subcmd === 'connect') {
                    document.getElementById('connectBleButton').click();
                } else if (subcmd === 'disconnect') {
                    if (chameleonUltra) {
                        await chameleonUltra.disconnect();
                        logToConsole('✓ Disconnected');
                    } else {
                        logToConsole('Not connected', true);
                    }
                } else if (subcmd === 'battery') {
                    if (!chameleonUltra) {
                        logToConsole('Not connected. Use: hw connect', true);
                        return;
                    }
                    const battery = await chameleonUltra.cmd(CMD_GET_BATTERY_INFO);
                    if (battery.status === 0x68) {
                        const voltage = (battery.data[0] | (battery.data[1] << 8)) / 1000;
                        const percent = battery.data[2];
                        logToConsole(`Battery: ${voltage.toFixed(2)}V (${percent}%)`);
                    } else {
                        logToConsole(`Error reading battery: Status ${battery.status}`, true);
                    }
                } else if (subcmd === 'slot') {
                    if (!argv[2]) {
                        logToConsole('Usage: hw slot <list|info|change|details>');
                        return;
                    }
                    const slotCmd = argv[2].toLowerCase();
                    if (slotCmd === 'list') {
                        logToConsole('Slots: 1-8 (use "hw slot change <n>" to switch)');
                    } else if (slotCmd === 'info') {
                        if (!chameleonUltra) {
                            logToConsole('Not connected. Use: hw connect', true);
                            return;
                        }
                        const slot = await chameleonUltra.cmd(CMD_GET_ACTIVE_SLOT);
                        if (slot.status === 0x68) {
                            logToConsole(`Current slot: ${slot.data[0] + 1}`);
                        } else {
                            logToConsole(`Error reading slot: Status ${slot.status}`, true);
                        }
                    } else if (slotCmd === 'details') {
                        if (!chameleonUltra) {
                            logToConsole('Not connected. Use: hw connect', true);
                            return;
                        }

                        // Get slot number (current if not specified)
                        let slotNum;
                        if (argv[3]) {
                            slotNum = parseInt(argv[3]);
                            if (slotNum < 1 || slotNum > 8) {
                                logToConsole('Slot must be 1-8', true);
                                return;
                            }
                        } else {
                            const currentSlot = await chameleonUltra.cmd(CMD_GET_ACTIVE_SLOT);
                            if (currentSlot.status !== 0x68) {
                                logToConsole('Error reading current slot', true);
                                return;
                            }
                            slotNum = currentSlot.data[0] + 1;
                        }

                        // Get slot info (tag types for all slots)
                        const slotInfo = await chameleonUltra.cmd(CMD_GET_SLOT_INFO);
                        if (slotInfo.status !== 0x68) {
                            logToConsole('Error reading slot info', true);
                            return;
                        }

                        // Parse slot data (HF and LF tag types, 2 bytes each, big-endian)
                        const slotIndex = (slotNum - 1) * 4;
                        const hfType = (slotInfo.data[slotIndex] << 8) | slotInfo.data[slotIndex + 1];
                        const lfType = (slotInfo.data[slotIndex + 2] << 8) | slotInfo.data[slotIndex + 3];

                        // Get nickname (TagSenseType: HF=2, LF=1)
                        const nickname = await chameleonUltra.cmd(CMD_GET_SLOT_TAG_NICK, new Uint8Array([slotNum - 1, 2])); // 2 = HF
                        let nickStr = 'Unnamed';
                        if (nickname.status === 0x68 && nickname.data.length > 0) {
                            nickStr = new TextDecoder().decode(nickname.data);
                        }

                        logToConsole(`Slot ${slotNum}: ${nickStr}`);
                        logToConsole(`  HF: ${getTagTypeName(hfType)}`);
                        logToConsole(`  LF: ${getTagTypeName(lfType)}`);
                    } else if (slotCmd === 'change') {
                        if (!argv[3]) {
                            logToConsole('Usage: hw slot change <1-8>');
                            return;
                        }
                        if (!chameleonUltra) {
                            logToConsole('Not connected. Use: hw connect', true);
                            return;
                        }
                        const slotNum = parseInt(argv[3]);
                        if (slotNum < 1 || slotNum > 8) {
                            logToConsole('Slot must be 1-8', true);
                            return;
                        }
                        const result = await chameleonUltra.cmd(CMD_SET_ACTIVE_SLOT, new Uint8Array([slotNum - 1]));
                        if (result.status === 0x68) {
                            logToConsole(`✓ Changed to slot ${slotNum}`);
                            // Trigger extension hooks
                            window.ChameleonAPI._trigger('onSlotChanged', slotNum);
                        } else {
                            logToConsole(`Error changing slot: Status ${result.status}`, true);
                        }
                    }
                } else {
                    logToConsole(`Unknown hw subcommand: ${subcmd}`, true);
                }
                return;
            }

            // Filesystem commands (fs)
            if (cmd === 'fs') {
                if (!argv[1]) {
                    logToConsole('Usage: fs <ls|cat|rm> [path]');
                    return;
                }

                const subcmd = argv[1].toLowerCase();

                if (subcmd === 'ls') {
                    const path = argv[2] || '/';

                    // List directories
                    const dirs = await fs.listDirectories();
                    const dirsInPath = dirs.filter(d => {
                        if (path === '/') {
                            return !d.path.includes('/', 1); // Top level only
                        }
                        return d.path.startsWith(path + '/') && !d.path.slice(path.length + 1).includes('/');
                    });

                    // List files
                    const files = await fs.listFiles(path);

                    if (dirsInPath.length === 0 && files.length === 0) {
                        logToConsole('(empty directory)');
                    } else {
                        for (const dir of dirsInPath) {
                            logToConsole(`  📁 ${dir.path}/`);
                        }
                        for (const file of files) {
                            const size = file.content.length;
                            logToConsole(`  📄 ${file.path.padEnd(30)} ${size} bytes`);
                        }
                    }
                } else if (subcmd === 'cat') {
                    if (!argv[2]) {
                        logToConsole('Usage: fs cat <file>');
                        return;
                    }
                    try {
                        const content = await fs.readFile(argv[2]);
                        logToConsole(content);
                    } catch (err) {
                        logToConsole(`Error: ${err.message}`, true);
                    }
                } else if (subcmd === 'rm') {
                    if (!argv[2]) {
                        logToConsole('Usage: fs rm <file>');
                        return;
                    }
                    try {
                        await fs.remove(argv[2]);
                        logToConsole(`✓ Deleted: ${argv[2]}`);
                        await refreshFileTree();
                    } catch (err) {
                        logToConsole(`Error: ${err.message}`, true);
                    }
                } else {
                    logToConsole(`Unknown fs subcommand: ${subcmd}`, true);
                }
                return;
            }

            logToConsole(`Unknown command: ${cmd}. Type 'help' for available commands.`, true);
        }

        // Tab completion
        async function handleTabCompletion() {
            const input = inputElement.value;
            const cursorPos = inputElement.selectionStart;
            const textBeforeCursor = input.substring(0, cursorPos);
            const argv = textBeforeCursor.trim().split(/\s+/);

            // Command completion (first word)
            if (argv.length === 1 && !textBeforeCursor.endsWith(' ')) {
                const partial = argv[0].toLowerCase();
                const allCommands = [
                    'help', 'clear', 'ls', 'cd', 'pwd', 'cat', 'rm', 'rmdir', 'mkdir', 'touch',
                    'hw', 'hf', 'fs', ...Object.keys(commands)
                ];
                const matches = allCommands.filter(cmd => cmd.startsWith(partial));

                if (matches.length === 1) {
                    inputElement.value = matches[0] + ' ';
                    inputElement.setSelectionRange(matches[0].length + 1, matches[0].length + 1);
                } else if (matches.length > 1) {
                    logToConsole('Possible commands: ' + matches.join(', '));
                }
                return;
            }

            // Subcommand completion for hw/hf commands
            if (argv.length === 2 && !textBeforeCursor.endsWith(' ')) {
                const cmd = argv[0].toLowerCase();
                const partial = argv[1].toLowerCase();

                let subcommands = [];
                if (cmd === 'hw') {
                    subcommands = ['connect', 'disconnect', 'battery', 'slot'];
                } else if (cmd === 'hf') {
                    subcommands = ['ntag'];
                }

                const matches = subcommands.filter(sub => sub.startsWith(partial));

                if (matches.length === 1) {
                    inputElement.value = cmd + ' ' + matches[0] + ' ';
                    inputElement.setSelectionRange(inputElement.value.length, inputElement.value.length);
                } else if (matches.length > 1) {
                    logToConsole('Possible subcommands: ' + matches.join(', '));
                }
                return;
            }

            // Third-level completion for "hw slot" commands
            if (argv.length === 3 && argv[0].toLowerCase() === 'hw' && argv[1].toLowerCase() === 'slot' && !textBeforeCursor.endsWith(' ')) {
                const partial = argv[2].toLowerCase();
                const slotCommands = ['list', 'info', 'change', 'details'];
                const matches = slotCommands.filter(sub => sub.startsWith(partial));

                if (matches.length === 1) {
                    inputElement.value = 'hw slot ' + matches[0] + ' ';
                    inputElement.setSelectionRange(inputElement.value.length, inputElement.value.length);
                } else if (matches.length > 1) {
                    logToConsole('Possible commands: ' + matches.join(', '));
                }
                return;
            }

            // Path completion
            const cmd = argv[0].toLowerCase();
            const pathCommands = ['ls', 'cd', 'cat', 'rm', 'rmdir', 'mkdir', 'touch'];

            if (pathCommands.includes(cmd)) {
                const partial = argv[argv.length - 1] || '';
                const isAbsolute = partial.startsWith('/');

                let searchPath, searchPrefix;
                if (partial.includes('/')) {
                    // Path contains slash - split it
                    const lastSlash = partial.lastIndexOf('/');
                    const pathPart = partial.substring(0, lastSlash);
                    searchPrefix = partial.substring(lastSlash + 1);

                    if (isAbsolute) {
                        searchPath = pathPart || '/';
                    } else {
                        searchPath = `${currentDir}/${pathPart}`.replace('//', '/');
                    }
                } else {
                    // No slash - search in current directory
                    searchPath = currentDir;
                    searchPrefix = partial;
                }

                // Get directories and files
                const dirs = await fs.listDirectories();
                const files = await fs.listFiles(searchPath);

                const dirsInPath = dirs.filter(d => {
                    if (searchPath === '/') {
                        return !d.path.includes('/', 1);
                    }
                    return d.path.startsWith(searchPath + '/') && !d.path.slice(searchPath.length + 1).includes('/');
                });

                const allItems = [
                    ...dirsInPath.map(d => d.path.split('/').pop() + '/'),
                    ...files.map(f => f.path.split('/').pop())
                ];

                const matches = allItems.filter(item => item.startsWith(searchPrefix));

                if (matches.length === 1) {
                    const completed = matches[0];
                    const beforePartial = input.substring(0, input.lastIndexOf(partial));

                    // Reconstruct the full path
                    let fullPath;
                    if (partial.includes('/')) {
                        const pathPrefix = partial.substring(0, partial.lastIndexOf('/') + 1);
                        fullPath = pathPrefix + completed;
                    } else {
                        fullPath = completed;
                    }

                    inputElement.value = beforePartial + fullPath;
                    inputElement.setSelectionRange(inputElement.value.length, inputElement.value.length);
                } else if (matches.length > 1) {
                    // Find common prefix among all matches
                    let commonPrefix = matches[0];
                    for (let i = 1; i < matches.length; i++) {
                        let j = 0;
                        while (j < commonPrefix.length && j < matches[i].length && commonPrefix[j] === matches[i][j]) {
                            j++;
                        }
                        commonPrefix = commonPrefix.substring(0, j);
                    }

                    // If common prefix is longer than what user typed, complete to common prefix
                    if (commonPrefix.length > searchPrefix.length) {
                        const beforePartial = input.substring(0, input.lastIndexOf(partial));
                        let fullPath;
                        if (partial.includes('/')) {
                            const pathPrefix = partial.substring(0, partial.lastIndexOf('/') + 1);
                            fullPath = pathPrefix + commonPrefix;
                        } else {
                            fullPath = commonPrefix;
                        }
                        inputElement.value = beforePartial + fullPath;
                        inputElement.setSelectionRange(inputElement.value.length, inputElement.value.length);
                    }

                    logToConsole('Possible completions: ' + matches.join(', '));
                }
            }
        }

        // Command history
        let commandHistory = [];
        let historyIndex = -1;

        inputElement.addEventListener("keydown", async (e) => {
            if (e.key === "Tab") {
                e.preventDefault();
                await handleTabCompletion();
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                if (commandHistory.length === 0) return;

                if (historyIndex === -1) {
                    historyIndex = commandHistory.length - 1;
                } else if (historyIndex > 0) {
                    historyIndex--;
                }

                inputElement.value = commandHistory[historyIndex];
            } else if (e.key === "ArrowDown") {
                e.preventDefault();
                if (historyIndex === -1) return;

                if (historyIndex < commandHistory.length - 1) {
                    historyIndex++;
                    inputElement.value = commandHistory[historyIndex];
                } else {
                    historyIndex = -1;
                    inputElement.value = "";
                }
            } else if (e.key === "Enter") {
                const command = inputElement.value.trim();
                if (!command) return;

                // Add to history
                if (commandHistory.length === 0 || commandHistory[commandHistory.length - 1] !== command) {
                    commandHistory.push(command);
                    // Keep history to last 100 commands
                    if (commandHistory.length > 100) {
                        commandHistory.shift();
                    }
                }
                historyIndex = -1;

                logToConsole(`> ${command}`);
                inputElement.value = "";

                try {
                    await parseCommand(command);
                } catch (err) {
                    logToConsole(`Error: ${err.message}`, true);
                }
            }
        });
