/**
 * Pyodide Loader Extension
 *
 * Automatically loads Pyodide at startup and sets up the Python environment.
 * This makes Python scripts run faster by avoiding repeated setup.
 *
 * Provides:
 * - window.pyodide - Pyodide instance
 * - window.pyodideReady - Boolean flag
 * - Automatic Python stdout/stderr redirect to app console
 * - chameleon_cmd() function available in Python
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

        // Expose Chameleon Ultra BLE command function to Python
        window.pyodide.globals.set('chameleon_cmd', async (cmdNum, silent = true) => {
            const chameleon = window.ChameleonAPI?.chameleonUltra || window.chameleonUltra;

            if (!chameleon) {
                throw new Error('Not connected to Chameleon Ultra. Please connect via BLE first.');
            }

            const result = await chameleon.cmd(cmdNum, null, silent);
            if (result && result.data) {
                // Convert to Python dict
                return window.pyodide.toPy({
                    cmd: result.cmd,
                    status: result.status,
                    data: Array.from(result.data)
                });
            }
            return null;
        });

        // Add helper utilities to Python
        await window.pyodide.runPythonAsync(`
# Helper constants
CMD_GET_BATTERY_INFO = 1025
CMD_GET_ACTIVE_SLOT = 1018
CMD_GET_SLOT_INFO = 1021

# Helper to check if connected
def is_connected():
    """Check if Chameleon Ultra is connected"""
    from js import ChameleonAPI
    return ChameleonAPI.chameleonUltra is not None

# Quick battery check
async def get_battery():
    """Get battery voltage and percentage"""
    result = await chameleon_cmd(CMD_GET_BATTERY_INFO, True)
    if result and result['data']:
        data = result['data']
        voltage = (data[1] << 8) | data[0]
        percentage = data[2] if len(data) > 2 else 0
        return {'voltage': voltage, 'percentage': percentage}
    return None

# Quick slot check
async def get_active_slot():
    """Get active slot number"""
    result = await chameleon_cmd(CMD_GET_ACTIVE_SLOT, True)
    if result and result['data']:
        return result['data'][0]
    return None

print("✓ Chameleon Ultra Python helpers loaded")
print("  - chameleon_cmd(cmd_num, silent=True)")
print("  - get_battery()")
print("  - get_active_slot()")
print("  - is_connected()")
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

// Register command to manually load Pyodide
API.registerCommand('py-init', 'Initialize Pyodide environment', async () => {
    await initPyodideEnvironment();
});

// Register command to check Pyodide status
API.registerCommand('py-status', 'Show Pyodide status', async () => {
    logToConsole('🐍 Pyodide Status:');
    logToConsole(`  Ready: ${window.pyodideReady ? '✅' : '❌'}`);
    logToConsole(`  Loading: ${window.pyodideLoading ? '⏳ Yes' : 'No'}`);

    if (window.pyodideReady) {
        const version = await window.pyodide.runPythonAsync('import sys; sys.version.split()[0]');
        logToConsole(`  Python Version: ${version}`);

        const packages = await window.pyodide.runPythonAsync(`
import sys
', '.join([pkg for pkg in ['numpy', 'asyncio'] if pkg in sys.modules])
`);
        if (packages) {
            logToConsole(`  Packages: ${packages}`);
        }
    }
});

// Register command to run Python one-liner
API.registerCommand('py', 'Execute Python code (e.g., py print(2+2))', async (args) => {
    if (!window.pyodideReady) {
        logToConsole('⚠️ Pyodide not ready. Run "py-init" first or wait for auto-load.', true);
        return;
    }

    if (args.length === 0) {
        logToConsole('Usage: py <python code>');
        logToConsole('Example: py print(2 + 2)');
        return;
    }

    const code = args.join(' ');

    try {
        await window.pyodide.runPythonAsync(code);
    } catch (error) {
        logToConsole(`❌ Python Error: ${error.message}`, true);
    }
});

// Register Python file runner
API.registerCommand('py-run', 'Run Python file from VFS (e.g., py-run /scripts/test.py)', async (args) => {
    if (!window.pyodideReady) {
        logToConsole('⚠️ Pyodide not ready. Run "py-init" first or wait for auto-load.', true);
        return;
    }

    if (args.length === 0) {
        logToConsole('Usage: py-run <filepath>');
        logToConsole('Example: py-run /scripts/battery.py');
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
logToConsole('  Commands: py, py-init, py-status, py-run');
logToConsole('  .py files auto-detected in Script Editor');
logToConsole('  Starting Pyodide background load...');

// Auto-load Pyodide at startup (asynchronously, don't block)
(async () => {
    await initPyodideEnvironment();
})().catch(err => {
    logToConsole(`❌ Async Pyodide load failed: ${err.message}`, true);
});
