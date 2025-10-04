/**
 * Pyodide Loader Extension
 * @name Python (Pyodide)
 * @version 1.0.0
 * @author Toolbox Team
 * @description Python 3.11 runtime with NumPy, device bridge, and auto-loading for .py scripts
 * @source https://pyodide.org
 */

const extensionName = 'Pyodide Loader';

if (!API) {
    console.error(`${extensionName}: API not available`);
    throw new Error('API not available');
}

const { logToConsole, chameleonUltra } = API;

// Track loading state
window.pyodideReady = false;
window.pyodideLoading = false;

/**
 * Initialize Pyodide environment
 */
async function initPyodideEnvironment() {
    if (window.pyodideReady) {
        logToConsole('⚡ Pyodide already loaded');
        return;
    }

    if (window.pyodideLoading) {
        logToConsole('⏳ Pyodide is already loading...');
        return;
    }

    try {
        window.pyodideLoading = true;
        logToConsole('🐍 Loading Pyodide environment...');

        // Load Pyodide script if not already loaded
        if (typeof loadPyodide === 'undefined') {
            logToConsole('📦 Downloading Pyodide from CDN (10-20 seconds)...');
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.js';
                script.onload = resolve;
                script.onerror = () => reject(new Error('Failed to load Pyodide script'));
                document.head.appendChild(script);
            });
        }

        // Initialize Pyodide
        logToConsole('⚙️ Initializing Pyodide runtime...');
        window.pyodide = await loadPyodide({
            indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.0/full/"
        });

        // Load NumPy
        logToConsole('📊 Loading NumPy package...');
        await window.pyodide.loadPackage('numpy');

        // Setup logging to app console
        const appLogToConsole = (msg) => {
            const container = document.getElementById("console-container");
            if (container) {
                const div = document.createElement("div");
                div.textContent = msg;
                container.appendChild(div);
                container.scrollTop = container.scrollHeight;
            }
            console.log(msg);
        };

        // Setup Python stdout/stderr redirect
        await window.pyodide.runPythonAsync(`
import sys
from io import StringIO

class AppConsoleLogger:
    def __init__(self, log_func):
        self.buffer = []
        self.log_func = log_func

    def write(self, text):
        if text.strip():
            self.buffer.append(text.strip())
            self.log_func(text.strip())

    def flush(self):
        pass

    def get_output(self):
        return '\\n'.join(self.buffer)
`);

        // Create logger instance
        const loggerClass = window.pyodide.runPython('AppConsoleLogger');
        const loggerInstance = loggerClass.callKwargs({ log_func: appLogToConsole });
        window.pyodide.globals.set('_app_logger', loggerInstance);

        await window.pyodide.runPythonAsync(`
import sys
sys.stdout = _app_logger
sys.stderr = _app_logger
`);

        // Expose generic device command function to Python (device-agnostic)
        window.pyodide.globals.set('device_cmd', async (cmd, data = null) => {
            const device = window.ToolboxAPI?.chameleonUltra || window.chameleonUltra;

            if (!device) {
                throw new Error('Not connected to any device. Please connect via BLE or Serial first.');
            }

            const result = await device.cmd(cmd, data);

            // Convert result to Python-friendly format
            if (result && typeof result === 'object') {
                // Handle both binary response objects and text responses
                if (result.data !== undefined) {
                    // Binary response (Chameleon Ultra style)
                    return window.pyodide.toPy({
                        cmd: result.cmd,
                        status: result.status,
                        data: Array.from(result.data)
                    });
                } else {
                    // Text response (Bruce style) or other format
                    return window.pyodide.toPy(result);
                }
            }

            // String response (Bruce serial output)
            return result;
        });

        // Add generic helper utilities to Python
        await window.pyodide.runPythonAsync(`
# Device-agnostic helper to check if connected
def is_connected():
    """Check if any device is connected"""
    from js import ToolboxAPI
    return ToolboxAPI.chameleonUltra is not None

# Access to ToolboxAPI constants (set by device extensions)
def get_device_constants():
    """Get constants exported by the current device extension"""
    from js import ToolboxAPI
    constants = {}

    # Get all device-specific constant namespaces
    if hasattr(ToolboxAPI, 'ChameleonUltra'):
        constants['ChameleonUltra'] = ToolboxAPI.ChameleonUltra.to_py()
    if hasattr(ToolboxAPI, 'Bruce'):
        constants['Bruce'] = ToolboxAPI.Bruce.to_py()

    return constants

print("✓ Python device bridge loaded")
print("  - device_cmd(cmd, data=None) - Send command to connected device")
print("  - is_connected() - Check if device is connected")
print("  - get_device_constants() - Get device-specific constants")
print("")
print("Access device constants from ToolboxAPI:")
print("  from js import ToolboxAPI")
print("  ToolboxAPI.ChameleonUltra.CMD_GET_BATTERY_INFO")
print("  ToolboxAPI.Bruce.WIFI_SCAN")
`);

        window.pyodideReady = true;
        logToConsole('✅ Pyodide environment ready!');
        logToConsole('   Python scripts can now use window.pyodide');
        logToConsole('   NumPy and helper functions available');

    } catch (error) {
        logToConsole(`❌ Failed to load Pyodide: ${error.message}`, true);
        window.pyodideReady = false;
    } finally {
        window.pyodideLoading = false;
    }
}

// Register Python as an extension
API.registerDevice('python', 'Python');

// Register Python file runner
API.registerDeviceCommand('python', 'py-run', 'Run Python file from VFS', async (args) => {
    if (!window.pyodideReady) {
        logToConsole('⚠️ Pyodide not ready. Wait for initialization...', true);
        return;
    }

    if (args.length === 0) {
        logToConsole('Usage: python py-run <filepath>');
        logToConsole('Example: python py-run /scripts/battery.py');
        return;
    }

    const filepath = args[0];

    try {
        // Read file from VFS
        const pythonCode = await API.fs.readFile(filepath);

        logToConsole(`🐍 Running ${filepath}...`);
        logToConsole('─'.repeat(60));

        // Run Python code
        await window.pyodide.runPythonAsync(pythonCode);

        logToConsole('─'.repeat(60));
        logToConsole('✓ Script execution complete');
    } catch (error) {
        logToConsole(`❌ Error: ${error.message}`, true);
    }
});

// Hook into script execution to auto-detect .py files
if (window.runFileFromFS) {
    const originalRunner = window.runFileFromFS;
    window.runFileFromFS = async function(path) {
        // If it's a .py file, use Python runner
        if (path.endsWith('.py')) {
            if (!window.pyodideReady) {
                console.log('⚠️ Pyodide not ready. Waiting for initialization...');
                // Wait up to 30 seconds for Pyodide to load
                for (let i = 0; i < 60; i++) {
                    if (window.pyodideReady) break;
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                if (!window.pyodideReady) {
                    console.log('❌ Pyodide still not ready. Please run "py-init" first.');
                    return;
                }
            }

            try {
                const pythonCode = await API.fs.readFile(path);
                console.log(`🐍 Running Python file: ${path}`);
                console.log('─'.repeat(60));

                await window.pyodide.runPythonAsync(pythonCode);

                console.log('─'.repeat(60));
                console.log('✓ Python script completed');
            } catch (error) {
                console.log(`❌ Error: ${error.message}`);
                throw error;
            }
        } else {
            // Run normally for .js files
            return originalRunner.call(this, path);
        }
    };
}

logToConsole(`✓ Extension loaded: ${extensionName}`);
logToConsole('  Commands: py-run');
logToConsole('  .py files auto-detected in Script Editor');
logToConsole('  Starting Pyodide background load...');

// Auto-load Pyodide at startup (asynchronously, don't block)
(async () => {
    await initPyodideEnvironment();
})().catch(err => {
    logToConsole(`❌ Async Pyodide load failed: ${err.message}`, true);
});
