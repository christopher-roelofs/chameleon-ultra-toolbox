        const outputDiv = document.getElementById("console-container");
        const inputElement = document.getElementById("input");
        const connectBleButton = document.getElementById("connectBleButton");
        const connectSerialButton = document.getElementById("connectSerialButton");

        // Command registry - MUST be defined early for extensions
        const commands = {};

        // Storage for loaded modules and scripts
        const wasmModules = {};
        const loadedScripts = {};
        const uploadedScripts = {}; // Scripts stored in localStorage

        // Make helper classes globally available
        window.NTAG215Database = null;
        window.NTAG215Reader = null;

        // Initialize Device Registry
        const deviceRegistry = new DeviceRegistry();
        window.deviceRegistry = deviceRegistry;

        // Initialize FileSystemManager
        let fs = null;
        let currentSelectedFile = null;

        async function initFileSystem() {
            try {
                fs = new FileSystemManager();
                await fs.init();
                window.ToolboxAPI.fs = fs; // Make it globally accessible via ToolboxAPI
                logToConsole('✓ Virtual filesystem initialized');

                // Create default directories
                try {
                    await fs.mkdir('/scripts');
                    await fs.mkdir('/data');
                    await fs.mkdir('/extensions');
                    logToConsole('✓ Created default directories: /scripts, /data, /extensions');
                } catch (mkdirError) {
                    logToConsole(`Error creating directories: ${mkdirError.message}`, true);
                }

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

        // Chameleon Ultra constants and classes moved to extension
        // See: extensions/chameleon-ultra-device.js

        // Tag type mapping (used by UI and scripts)
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

        // Legacy ChameleonUltraBLE and ChameleonUltraSerial classes removed
        // Now loaded from extension: extensions/chameleon-ultra-device.js

        let chameleonUltra = null; // Instance of the new class

        // Device selection modal
        function showDeviceSelectionModal(devices, connectionType) {
            return new Promise((resolve) => {
                const modal = document.getElementById('genericModal');
                const title = document.getElementById('modalTitle');
                const body = document.getElementById('modalBody');
                const footer = document.getElementById('modalFooter');

                title.textContent = `Select Device Type (${connectionType})`;

                body.innerHTML = `
                    <p>Which device type is this?</p>
                    <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 15px;">
                        ${devices.map(d => `
                            <button class="device-option" data-id="${d.id}" style="padding: 15px; text-align: left; cursor: pointer; border: 1px solid #444; background: #2a2a2a; border-radius: 4px;">
                                <strong>${d.name}</strong>
                                <br><small style="color: #888;">${d.description || 'No description'}</small>
                            </button>
                        `).join('')}
                    </div>
                `;

                footer.innerHTML = `
                    <button onclick="closeGenericModal()" style="background: #666;">Cancel (use raw mode)</button>
                `;

                // Add click handlers
                body.querySelectorAll('.device-option').forEach(btn => {
                    btn.addEventListener('click', () => {
                        resolve(btn.dataset.id);
                        closeGenericModal();
                    });
                });

                // Handle cancel
                const originalClose = window.closeGenericModal;
                window.closeGenericModal = () => {
                    resolve(null);
                    if (originalClose) originalClose();
                    modal.style.display = 'none';
                };

                modal.style.display = 'flex';
            });
        }

        connectBleButton.addEventListener("click", async () => {
            logToConsole("Select a BLE device from the browser dialog...");
            try {
                // Connect to BLE device with no filters (user picks any device)
                const transport = new BLETransport();
                await transport.connect({
                    serviceUUID: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
                    txCharacteristicUUID: '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
                    rxCharacteristicUUID: '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
                    filters: []
                });

                logToConsole(`✓ BLE connected: ${transport.device?.name || 'Unknown'}`);

                // Get all BLE device extensions
                const bleDevices = deviceRegistry.getAllDevices().filter(d => d.id.includes('ble'));

                if (bleDevices.length === 0) {
                    // No extensions - use raw mode
                    window.rawBLE = transport;
                    logToConsole(`No device extensions loaded. Access via: window.rawBLE`);
                } else if (bleDevices.length === 1) {
                    // Only one extension - use it automatically
                    const deviceInfo = deviceRegistry.getDevice(bleDevices[0].id);
                    const device = new deviceInfo.class();

                    // Call device's connect() with existing transport
                    await device.connect("ble", { transport: transport });
                    device.name = bleDevices[0].name;

                    chameleonUltra = device;
                    window.ToolboxAPI.chameleonUltra = device;
                    window.ToolboxAPI._trigger('onDeviceConnected', device);

                    logToConsole(`✓ Using ${bleDevices[0].name}`);
                } else {
                    // Multiple extensions - show selection modal
                    const deviceType = await showDeviceSelectionModal(bleDevices, 'BLE');

                    if (deviceType) {
                        const deviceInfo = deviceRegistry.getDevice(deviceType);
                        const device = new deviceInfo.class();
                        device.transport = transport;
                        device.name = deviceInfo.metadata.name;

                        // Set up device-specific response handler
                        if (device.buffer !== undefined) {
                            // Device uses frame parsing (Chameleon Ultra style)
                            transport.onData((data) => {
                                const newBuffer = new Uint8Array(device.buffer.length + data.length);
                                newBuffer.set(device.buffer);
                                newBuffer.set(data, device.buffer.length);
                                device.buffer = newBuffer;
                                if (device.parseFrames) {
                                    device.parseFrames(device.buffer);
                                }
                            });
                        }
                        transport.onData((data) => {
                            if (device.responseQueue) {
                                device.responseQueue.push(data);
                            }
                        });

                        chameleonUltra = device;
                        window.ToolboxAPI.chameleonUltra = device;
                        window.ToolboxAPI._trigger('onDeviceConnected', device);

                        logToConsole(`✓ Using ${deviceInfo.metadata.name}`);
                    } else {
                        // User cancelled - use raw mode
                        window.rawBLE = transport;
                        logToConsole(`Raw BLE mode. Access via: window.rawBLE`);
                    }
                }

            } catch (error) {
                logToConsole(`BLE Connection Error: ${error.message}`, true);
            }
        });

        connectSerialButton.addEventListener("click", async () => {
            logToConsole("Select a Serial port from the browser dialog...");
            try {
                // Connect to Serial device
                const transport = new SerialTransport();
                await transport.connect({ baudRate: 115200 });

                logToConsole(`✓ Serial connected at 115200 baud`);

                // Get all Serial device extensions
                const serialDevices = deviceRegistry.getAllDevices().filter(d => d.id.includes('serial'));

                if (serialDevices.length === 0) {
                    // No extensions - use raw mode
                    window.rawSerial = transport;
                    logToConsole(`No device extensions loaded. Access via: window.rawSerial`);
                } else if (serialDevices.length === 1) {
                    // Only one extension - use it automatically
                    const deviceInfo = deviceRegistry.getDevice(serialDevices[0].id);
                    const device = new deviceInfo.class();

                    // Call device's connect() with existing transport
                    await device.connect('serial', { transport: transport });
                    device.name = serialDevices[0].name;

                    chameleonUltra = device;
                    window.ToolboxAPI.chameleonUltra = device;
                    window.ToolboxAPI._trigger('onDeviceConnected', device);

                    logToConsole(`✓ Using ${serialDevices[0].name}`);
                } else {
                    // Multiple extensions - show selection modal
                    const deviceType = await showDeviceSelectionModal(serialDevices, 'Serial');

                    if (deviceType) {
                        const deviceInfo = deviceRegistry.getDevice(deviceType);
                        const device = new deviceInfo.class();

                        // Call device's connect() with existing transport
                        await device.connect('serial', { transport: transport });
                        device.name = deviceInfo.metadata.name;

                        chameleonUltra = device;
                        window.ToolboxAPI.chameleonUltra = device;
                        window.ToolboxAPI._trigger('onDeviceConnected', device);

                        logToConsole(`✓ Using ${deviceInfo.metadata.name}`);
                    } else {
                        // User cancelled - use raw mode
                        window.rawSerial = transport;
                        logToConsole(`Raw Serial mode. Access via: window.rawSerial`);
                    }
                }

            } catch (error) {
                logToConsole(`Serial Connection Error: ${error.message}`, true);
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

            // Force refresh to ensure proper gutter rendering
            setTimeout(() => codeEditor.refresh(), 100);

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
                } else {
                    // Initialize with empty string to ensure gutters render properly
                    codeEditor.setValue('');
                }
            } else if (disableAutoRestore) {
                logToConsole('ℹ️  Auto-restore disabled');
                codeEditor.setValue('');
            } else {
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
            } else if (tabName === 'editor' && codeEditor) {
                // Refresh CodeMirror when switching to editor tab to fix gutter rendering
                setTimeout(() => codeEditor.refresh(), 10);
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
                // Show Run button for .js, .py, and .lua files
                const isRunnable = node.name.endsWith('.js') ||
                                 node.name.endsWith('.py') ||
                                 node.name.endsWith('.lua');

                if (isRunnable) {
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
                const textExtensions = ['.js', '.py', '.lua', '.txt', '.md', '.json', '.html', '.css', '.xml', '.csv', '.log'];
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

        // Helper function to detect and set CodeMirror mode based on file extension
        function setEditorModeByFilename(filename) {
            let mode = 'javascript'; // default
            let modeLabel = 'JavaScript';

            if (filename.endsWith('.py')) {
                mode = 'python';
                modeLabel = 'Python';
            } else if (filename.endsWith('.lua')) {
                mode = 'lua';
                modeLabel = 'Lua';
            } else if (filename.endsWith('.js')) {
                mode = 'javascript';
                modeLabel = 'JavaScript';
            } else if (filename.endsWith('.json')) {
                mode = { name: 'javascript', json: true };
                modeLabel = 'JSON';
            } else if (filename.endsWith('.md')) {
                mode = 'markdown';
                modeLabel = 'Markdown';
            }

            codeEditor.setOption('mode', mode);
            logToConsole(`📝 Editor mode: ${modeLabel}`);
        }

        async function editFileFromFS(path) {
            try {
                const content = await fs.readFile(path);

                // Check if content is binary (Uint8Array) or text (string)
                let textContent;
                if (content instanceof Uint8Array) {
                    // Binary file - check if it's a text-compatible binary or pure binary
                    const filename = path.substring(path.lastIndexOf('/') + 1);
                    if (filename.endsWith('.bin') || filename.endsWith('.dat')) {
                        // Pure binary file - show hex dump instead
                        textContent = '// Binary file - Hex dump:\n// File size: ' + content.length + ' bytes\n\n';
                        for (let i = 0; i < Math.min(content.length, 1024); i += 16) {
                            const chunk = content.slice(i, i + 16);
                            const hex = Array.from(chunk).map(b => b.toString(16).padStart(2, '0')).join(' ');
                            const ascii = Array.from(chunk).map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.').join('');
                            textContent += `// ${i.toString(16).padStart(4, '0')}: ${hex.padEnd(48, ' ')} | ${ascii}\n`;
                        }
                        if (content.length > 1024) {
                            textContent += `\n// ... (${content.length - 1024} more bytes)`;
                        }
                    } else {
                        // Try to decode as UTF-8 text
                        const decoder = new TextDecoder('utf-8', { fatal: false });
                        textContent = decoder.decode(content);
                    }
                } else {
                    textContent = content;
                }

                codeEditor.setValue(textContent);
                document.getElementById('scriptName').value = path.substring(path.lastIndexOf('/') + 1);
                switchTab('editor');

                // Store the path so we can save back to VFS
                codeEditor._currentVFSPath = path;

                // Set syntax highlighting based on file type
                const filename = path.substring(path.lastIndexOf('/') + 1);
                setEditorModeByFilename(filename);

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

            // Get filename and detect extension
            const scriptName = document.getElementById('scriptName').value.trim();

            // Extract extension from filename
            const lastDot = scriptName.lastIndexOf('.');
            const hasExtension = lastDot > 0 && lastDot < scriptName.length - 1;

            if (!hasExtension) {
                logToConsole('❌ Please add a file extension (.js, .py, or .lua)', true);
                return;
            }

            const extension = scriptName.substring(lastDot).toLowerCase();

            try {
                // Python files
                if (extension === '.py') {
                    if (!window.pyodideReady) {
                        logToConsole('⚠️ Pyodide not ready. Please wait for initialization...', true);
                        return;
                    }
                    logToConsole(`🐍 Running Python script...`);
                    logToConsole('─'.repeat(60));
                    await window.pyodide.runPythonAsync(code);
                    logToConsole('─'.repeat(60));
                    logToConsole('✓ Python script completed');
                    return;
                }

                // Lua files
                if (extension === '.lua') {
                    if (!window.luaReady) {
                        logToConsole('⚠️ Lua not ready. Please wait for initialization...', true);
                        return;
                    }
                    logToConsole(`🌙 Running Lua script...`);
                    logToConsole('─'.repeat(60));
                    await window.lua.doString(code);
                    logToConsole('─'.repeat(60));
                    logToConsole('✓ Lua script completed');
                    return;
                }

                // JavaScript files
                if (extension === '.js') {
                    logToConsole(`▶ Running JavaScript script...`);
                    const scriptFunc = new Function(code);
                    const result = scriptFunc.call(window);

                    // Handle async functions
                    if (result && typeof result.then === 'function') {
                        await result;
                    }
                    return;
                }

                // Unsupported extension
                logToConsole(`❌ Unsupported file type: ${extension}. Use .js, .py, or .lua`, true);

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
        async function loadScriptFromURL() {
            const urlParams = new URLSearchParams(window.location.search);
            const sharedScript = urlParams.get('script');
            const loadFile = urlParams.get('load'); // Support loading external files

            if (sharedScript) {
                try {
                    // Decode base64 (URLSearchParams already handles URL decoding)
                    const binaryString = atob(sharedScript);

                    // Convert binary string to Uint8Array
                    const compressedBytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        compressedBytes[i] = binaryString.charCodeAt(i);
                    }

                    // Decompress using DecompressionStream
                    const decompressedStream = new Response(
                        new Blob([compressedBytes]).stream().pipeThrough(new DecompressionStream('gzip'))
                    );
                    const decompressedData = await decompressedStream.arrayBuffer();

                    // Convert to UTF-8 string
                    const decoder = new TextDecoder();
                    const decoded = decoder.decode(decompressedData);
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
        async function shareViaURL() {
            const code = codeEditor.getValue();
            const name = document.getElementById('scriptName').value;

            if (!code.trim()) {
                logToConsole('❌ Editor is empty', true);
                return;
            }

            const scriptData = { name, code };
            const jsonString = JSON.stringify(scriptData);

            // Compress using gzip
            const encoder = new TextEncoder();
            const data = encoder.encode(jsonString);

            // Use CompressionStream for gzip compression
            const compressedStream = new Response(
                new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'))
            );
            const compressedData = new Uint8Array(await compressedStream.arrayBuffer());

            // Convert to binary string for base64 encoding
            let binaryString = '';
            for (let i = 0; i < compressedData.length; i++) {
                binaryString += String.fromCharCode(compressedData[i]);
            }
            const encoded = btoa(binaryString);
            const urlSafe = encodeURIComponent(encoded);
            const shareURL = `${window.location.origin}${window.location.pathname}?script=${urlSafe}`;

            // Check if URL is too long (most servers support up to 8000, but be conservative)
            if (shareURL.length > 6000) {
                const compressRatio = ((1 - (compressedData.length / data.length)) * 100).toFixed(1);
                logToConsole(`⚠️ Script too large for URL sharing (${shareURL.length} chars, ${compressRatio}% compression)`, true);
                logToConsole('💡 Tip: Use "💾 Save" to save to filesystem instead.', false);
                return;
            }

            // Copy to clipboard
            navigator.clipboard.writeText(shareURL).then(() => {
                logToConsole('✓ Share link copied to clipboard!');
                logToConsole(`📋 ${shareURL.substring(0, 80)}... (${shareURL.length} chars)`);
            }).catch(() => {
                // Fallback: show URL for manual copy
                logToConsole('📋 Share URL:');
                logToConsole(shareURL);
            });
        }

        // Share via QR Code
        async function shareViaQR() {
            const code = codeEditor.getValue();
            const name = document.getElementById('scriptName').value;

            if (!code.trim()) {
                logToConsole('❌ Editor is empty', true);
                return;
            }

            const scriptData = { name, code };
            const jsonString = JSON.stringify(scriptData);

            // Compress using gzip
            const encoder = new TextEncoder();
            const data = encoder.encode(jsonString);

            const compressedStream = new Response(
                new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'))
            );
            const compressedData = new Uint8Array(await compressedStream.arrayBuffer());

            // Convert to binary string for base64 encoding
            let binaryString = '';
            for (let i = 0; i < compressedData.length; i++) {
                binaryString += String.fromCharCode(compressedData[i]);
            }
            const encoded = btoa(binaryString);
            const urlSafe = encodeURIComponent(encoded);
            const shareURL = `${window.location.origin}${window.location.pathname}?script=${urlSafe}`;

            // QR codes have a maximum capacity (~2953 bytes for version 40-L)
            if (shareURL.length > 2000) {
                logToConsole('❌ Script is too large for QR code. Use "Copy Link" instead.', true);
                return;
            }

            // Clear previous QR code
            const qrDiv = document.getElementById('qrcode');
            qrDiv.innerHTML = '';

            try {
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
            } catch (error) {
                logToConsole('❌ Failed to generate QR code. Script may be too large.', true);
                console.error('QR code error:', error);
            }
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

        // Device registry for device-specific commands
        const deviceCommands = {}; // { deviceName: { commandName: { description, handler } } }
        const deviceExtensions = new Set(); // Track loaded device extensions

        // Extension API
        window.ToolboxAPI = {
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

            // Register a device extension
            registerDevice: function(deviceName, displayName) {
                const devName = deviceName.toLowerCase();
                deviceExtensions.add(devName);
                deviceCommands[devName] = {
                    displayName: displayName || deviceName,
                    commands: {}
                };
                console.log('Registered device:', devName);
                logToConsole(`✓ Device extension loaded: ${displayName || deviceName}`);
            },

            // Register a device-specific command
            registerDeviceCommand: function(deviceName, commandName, description, handler) {
                const devName = deviceName.toLowerCase();
                const cmdName = commandName.toLowerCase();

                if (!deviceCommands[devName]) {
                    console.error(`Device '${deviceName}' not registered. Call registerDevice first.`);
                    return;
                }

                deviceCommands[devName].commands[cmdName] = {
                    description: description,
                    handler: handler
                };
                console.log(`Registered device command: ${devName} ${cmdName}`);
                logToConsole(`✓ ${deviceCommands[devName].displayName} registered command: ${commandName}`);
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
            chameleonUltra: null, // Will be set after device connection (legacy)
            deviceRegistry: deviceRegistry, // New device registry

            // Access to UI elements
            switchTab: switchTab,
            refreshFileTree: refreshFileTree,

            // Utility functions
            getTagTypeName: getTagTypeName,
            currentDir: () => currentDir,

            // Raw connection helpers
            connectRawBLE: async (serviceUUID, txUUID, rxUUID, filters = []) => {
                const transport = new BLETransport();
                await transport.connect({
                    serviceUUID,
                    txCharacteristicUUID: txUUID,
                    rxCharacteristicUUID: rxUUID,
                    filters
                });
                return transport;
            },

            connectRawSerial: async (baudRate = 115200) => {
                const transport = new SerialTransport();
                await transport.connect({ baudRate });
                return transport;
            },

            // Helper utilities
            str2bytes: (str) => new TextEncoder().encode(str),
            hex2bytes: (hex) => {
                const cleaned = hex.replace(/[^0-9a-fA-F]/g, '');
                const bytes = new Uint8Array(cleaned.length / 2);
                for (let i = 0; i < bytes.length; i++) {
                    bytes[i] = parseInt(cleaned.substr(i * 2, 2), 16);
                }
                return bytes;
            },
            bytes2hex: (bytes) => Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''),
            bytes2str: (bytes) => new TextDecoder().decode(bytes),

            // File operations
            readFile: async (path) => {
                if (!fs) throw new Error('Filesystem not initialized');
                return await fs.readFile(path);
            },

            writeFile: async (path, data) => {
                if (!fs) throw new Error('Filesystem not initialized');
                return await fs.writeFile(path, data);
            },

            // Helper/Library loading
            loadHelper: async (helperName) => {
                const helperPath = `/helpers/${helperName}.js`;
                if (!fs) throw new Error('Filesystem not initialized');

                try {
                    const code = await fs.readFile(helperPath);
                    const helperFunc = new Function('API', code);
                    await helperFunc.call(window, window.ToolboxAPI);
                    logToConsole(`✓ Loaded helper: ${helperName}`);
                    return true;
                } catch (err) {
                    logToConsole(`Error loading helper ${helperName}: ${err.message}`, true);
                    return false;
                }
            },

            loadScript: async (scriptPath) => {
                // Support both /scripts/file.js and scripts/file.js formats
                let fullPath = scriptPath;
                if (!scriptPath.startsWith('/')) {
                    fullPath = '/' + scriptPath;
                }

                if (!fs) throw new Error('Filesystem not initialized');

                try {
                    const code = await fs.readFile(fullPath);
                    const scriptFunc = new Function('API', code);
                    await scriptFunc.call(window, window.ToolboxAPI);
                    logToConsole(`✓ Loaded script: ${scriptPath}`);
                    return true;
                } catch (err) {
                    logToConsole(`Error loading script ${scriptPath}: ${err.message}`, true);
                    return false;
                }
            }

            // Constants will be added by device extensions (e.g., CMD_GET_BATTERY_INFO)
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

        // Parse metadata from file headers (JSDoc, Python docstring, or Lua block comment)
        function parseMetadata(fileContent) {
            const metadata = {
                name: null,
                version: null,
                author: null,
                description: null,
                source: null
            };

            let block = null;

            // Try JSDoc-style block comments (/** ... */)
            const jsdocMatch = fileContent.match(/^\/\*\*[\s\S]*?\*\//);
            if (jsdocMatch) {
                block = jsdocMatch[0];
            }

            // Try Python docstrings (""" ... """)
            const pythonMatch = fileContent.match(/^"""[\s\S]*?"""/);
            if (pythonMatch) {
                block = pythonMatch[0];
            }

            // Try Lua block comments (--[[ ... --]])
            const luaMatch = fileContent.match(/^--\[\[[\s\S]*?--\]\]/);
            if (luaMatch) {
                block = luaMatch[0];
            }

            if (block) {
                // Extract @tags
                const nameMatch = block.match(/@name\s+(.+)/);
                const versionMatch = block.match(/@version\s+(.+)/);
                const authorMatch = block.match(/@author\s+(.+)/);
                const descMatch = block.match(/@description\s+(.+)/);
                const sourceMatch = block.match(/@source\s+(.+)/);

                if (nameMatch) metadata.name = nameMatch[1].trim();
                if (versionMatch) metadata.version = versionMatch[1].trim();
                if (authorMatch) metadata.author = authorMatch[1].trim();
                if (descMatch) metadata.description = descMatch[1].trim();
                if (sourceMatch) metadata.source = sourceMatch[1].trim();
            }

            return metadata;
        }

        // Store extension metadata
        const extensionMetadata = new Map();

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
                window.ToolboxAPI.fs = fs;
                window.ToolboxAPI.chameleonUltra = chameleonUltra;

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

                            // Parse and store metadata
                            const metadata = parseMetadata(code);
                            extensionMetadata.set(ext.path, metadata);

                            // Execute extension in a context with access to API
                            const extensionFunc = new Function('API', code);
                            await extensionFunc.call(window, window.ToolboxAPI);

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
            description: 'Show available commands or device-specific help (e.g., help chameleon)',
            handler: (args) => {
                // If device name provided, show device-specific help
                if (args && args.length > 0) {
                    const deviceName = args.join(' ').toLowerCase();
                    if (deviceCommands[deviceName]) {
                        const device = deviceCommands[deviceName];
                        logToConsole(`${device.displayName} Commands:`);
                        logToConsole('');
                        const cmds = Object.entries(device.commands).sort((a, b) => a[0].localeCompare(b[0]));
                        if (cmds.length === 0) {
                            logToConsole('  No commands registered');
                        } else {
                            cmds.forEach(([cmd, info]) => {
                                logToConsole(`  ${deviceName} ${cmd.padEnd(20)} - ${info.description}`);
                            });
                        }
                        logToConsole('');
                        return;
                    } else {
                        logToConsole(`Device '${deviceName}' not found. Use 'devices' to see available devices.`, true);
                        return;
                    }
                }

                // Show general help
                logToConsole('Available commands:');
                logToConsole('');
                logToConsole('  Core commands:');
                logToConsole('  devices             - List available device extensions');
                logToConsole('  help [device]       - Show commands for a specific device');
                logToConsole('  info <path>         - Show metadata for extension or script');
                logToConsole('  clear               - Clear console');
                logToConsole('  reset               - Reset filesystem (deletes all files)');
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

                    // Show extensions
                    if (deviceExtensions.size > 0) {
                        logToConsole('');
                        logToConsole('  Extensions:');
                        Array.from(deviceExtensions).sort().forEach(deviceName => {
                            const device = deviceCommands[deviceName];
                            const cmdCount = Object.keys(device.commands).length;
                            logToConsole(`  ${deviceName.padEnd(20)} - ${device.displayName} (${cmdCount} commands - use 'help ${deviceName}')`);
                        });
                    }
            }
        };

        commands['clear'] = {
            description: 'Clear console',
            handler: () => clearConsole()
        };

        commands['info'] = {
            description: 'Show metadata for extension or script (e.g., info /extensions/rfid-analyzer.js)',
            handler: async (args) => {
                if (!args || args.length === 0) {
                    logToConsole('Usage: info <path>');
                    logToConsole('Example: info /extensions/rfid-analyzer.js');
                    logToConsole('         info /scripts/battery.py');
                    return;
                }

                const path = args.join(' ');

                try {
                    // Check if file exists and read it
                    const content = await fs.readFile(path);
                    const metadata = parseMetadata(content);

                    // Display metadata
                    logToConsole(`📄 ${path}`);
                    logToConsole('─'.repeat(60));

                    if (metadata.name) {
                        logToConsole(`  Name:        ${metadata.name}`);
                    }
                    if (metadata.version) {
                        logToConsole(`  Version:     ${metadata.version}`);
                    }
                    if (metadata.author) {
                        logToConsole(`  Author:      ${metadata.author}`);
                    }
                    if (metadata.description) {
                        logToConsole(`  Description: ${metadata.description}`);
                    }
                    if (metadata.source) {
                        logToConsole(`  Source:      ${metadata.source}`);
                    }

                    // Check if any metadata was found
                    if (!metadata.name && !metadata.version && !metadata.author && !metadata.description && !metadata.source) {
                        logToConsole(`  No metadata found`);
                        logToConsole('');
                        logToConsole('  Add metadata using JSDoc format:');
                        logToConsole('  /**');
                        logToConsole('   * @name My Extension');
                        logToConsole('   * @version 1.0.0');
                        logToConsole('   * @author Your Name');
                        logToConsole('   * @description What this does');
                        logToConsole('   * @source https://github.com/user/repo');
                        logToConsole('   */');
                    }

                    logToConsole('─'.repeat(60));
                } catch (error) {
                    logToConsole(`Error reading ${path}: ${error.message}`, true);
                }
            }
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
                            The filesystem will be reset to default with empty /scripts, /data, and /extensions folders.
                        </p>
                    </div>
                `, [
                    {
                        text: 'Cancel',
                        className: 'btn-secondary'
                    },
                    {
                        text: '🗑️ Reset Filesystem',
                        className: 'btn-danger',
                        onClick: async () => {
                            try {
                                logToConsole('Resetting filesystem...');

                                if (!fs || !fs.db) {
                                    logToConsole('Filesystem not initialized, reinitializing from scratch...');

                                    // Force delete the database using DevTools approach
                                    const dbDeletePromise = new Promise((resolve) => {
                                        const req = indexedDB.deleteDatabase('UltraToolboxFS');
                                        req.onsuccess = () => {
                                            logToConsole('✓ Old database deleted');
                                            resolve();
                                        };
                                        req.onerror = () => {
                                            logToConsole('⚠️ Could not delete old database, proceeding anyway...');
                                            resolve();
                                        };
                                        req.onblocked = () => {
                                            logToConsole('⚠️ Database blocked, proceeding anyway...');
                                            resolve();
                                        };
                                        // Timeout after 500ms
                                        setTimeout(() => resolve(), 500);
                                    });

                                    await dbDeletePromise;
                                    await initFileSystem();
                                    logToConsole('✓ Filesystem initialized with default folders');
                                    return;
                                }

                                // Get list of all files and directories to delete
                                const allFiles = await fs.listFiles('/');
                                const allDirs = await fs.listDirectories();

                                logToConsole(`Deleting ${allFiles.length} files and ${allDirs.length} directories...`);

                                // Delete all files
                                for (const file of allFiles) {
                                    await fs.deleteFile(file.path);
                                }

                                // Delete all directories (except root)
                                const dirsToDelete = allDirs.filter(d => d.path !== '/');
                                for (const dir of dirsToDelete) {
                                    await fs.remove(dir.path);
                                }

                                logToConsole('✓ All files deleted');

                                // Recreate default directories
                                logToConsole('Creating default directories...');
                                await fs.mkdir('/scripts');
                                await fs.mkdir('/data');
                                await fs.mkdir('/extensions');

                                // Refresh the file tree display
                                await refreshFileTree();

                                logToConsole('✓ Filesystem reset complete');
                                logToConsole('Default folders created: /scripts, /data, /extensions');
                            } catch (error) {
                                logToConsole(`Error resetting filesystem: ${error.message}`, true);
                                logToConsole('Try running in DevTools console: indexedDB.deleteDatabase("UltraToolboxFS")');
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

            // Check device-specific commands first (e.g., "chameleonultra battery")
            if (deviceCommands[cmd]) {
                const deviceName = cmd;
                const device = deviceCommands[deviceName];

                // If no subcommand provided, show help for this device
                if (!argv[1]) {
                    logToConsole(`${device.displayName} Commands:`);
                    logToConsole('');
                    const cmds = Object.entries(device.commands).sort((a, b) => a[0].localeCompare(b[0]));
                    if (cmds.length === 0) {
                        logToConsole('  No commands registered');
                    } else {
                        cmds.forEach(([cmdName, info]) => {
                            logToConsole(`  ${deviceName} ${cmdName.padEnd(20)} - ${info.description}`);
                        });
                    }
                    logToConsole('');
                    return;
                }

                // Execute the subcommand
                const deviceCmd = argv[1].toLowerCase();
                if (device.commands[deviceCmd]) {
                    await device.commands[deviceCmd].handler(argv.slice(2));
                    return;
                } else {
                    logToConsole(`Unknown ${device.displayName} command: ${argv[1]}. Use 'help ${deviceName}' to see available commands.`, true);
                    return;
                }
            }

            // Check registered commands (includes extensions)
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

                // Build list of all available commands (removing duplicates)
                const shellCommands = ['ls', 'cd', 'pwd', 'cat', 'rm', 'rmdir', 'mkdir', 'touch', 'fs'];
                const builtInCommands = ['help', 'clear', 'reset', 'devices'];
                const extensionCommands = Object.keys(commands);
                const deviceNames = Array.from(deviceExtensions);

                // Combine and deduplicate
                const allCommands = [...new Set([
                    ...builtInCommands,
                    ...shellCommands,
                    ...extensionCommands,
                    ...deviceNames
                ])];

                const matches = allCommands.filter(cmd => cmd.startsWith(partial));

                if (matches.length === 1) {
                    inputElement.value = matches[0] + ' ';
                    inputElement.setSelectionRange(matches[0].length + 1, matches[0].length + 1);
                } else if (matches.length > 1) {
                    logToConsole('Possible commands: ' + matches.join(', '));
                }
                return;
            }

            // Second word completion
            if (argv.length === 2 && !textBeforeCursor.endsWith(' ')) {
                const firstWord = argv[0].toLowerCase();
                const partial = argv[1].toLowerCase();

                // Help command - autocomplete device names
                if (firstWord === 'help') {
                    const deviceNames = Array.from(deviceExtensions);
                    const matches = deviceNames.filter(name => name.startsWith(partial));

                    if (matches.length === 1) {
                        inputElement.value = 'help ' + matches[0];
                        inputElement.setSelectionRange(inputElement.value.length, inputElement.value.length);
                    } else if (matches.length > 1) {
                        logToConsole('Available devices: ' + matches.join(', '));
                    }
                    return;
                }

                // Device command completion (e.g., "chameleon bat" -> "chameleon battery")
                if (deviceCommands[firstWord]) {
                    const cmdNames = Object.keys(deviceCommands[firstWord].commands);
                    const matches = cmdNames.filter(cmd => cmd.startsWith(partial));

                    if (matches.length === 1) {
                        inputElement.value = firstWord + ' ' + matches[0] + ' ';
                        inputElement.setSelectionRange(inputElement.value.length, inputElement.value.length);
                    } else if (matches.length > 1) {
                        logToConsole('Possible commands: ' + matches.join(', '));
                    }
                    return;
                }
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
