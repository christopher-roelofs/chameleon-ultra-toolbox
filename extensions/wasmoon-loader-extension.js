/**
 * Wasmoon (Lua) Loader Extension
 *
 * Automatically loads Wasmoon (Lua 5.4 in WebAssembly) at startup.
 * Much faster and smaller than Pyodide (~100KB vs ~10MB).
 *
 * Provides:
 * - window.lua - Lua engine instance
 * - window.luaReady - Boolean flag
 * - Automatic Lua print() redirect to app console
 * - chameleon_cmd() function available in Lua
 */

const extensionName = 'Wasmoon Loader';

if (!API) {
    console.error(`${extensionName}: API not available`);
    throw new Error('API not available');
}

const { logToConsole, chameleonUltra } = API;

// Track loading state
window.luaReady = false;
window.luaLoading = false;

/**
 * Initialize Wasmoon (Lua) environment
 */
async function initLuaEnvironment() {
    if (window.luaReady) {
        logToConsole('⚡ Lua already loaded');
        return;
    }

    if (window.luaLoading) {
        logToConsole('⏳ Lua is already loading...');
        return;
    }

    try {
        window.luaLoading = true;
        logToConsole('🌙 Loading Wasmoon (Lua 5.4)...');

        // Load Wasmoon from CDN as ES module
        if (!window.wasmoonModule) {
            logToConsole('📦 Downloading Wasmoon from CDN (~100KB)...');
            window.wasmoonModule = await import('https://cdn.jsdelivr.net/npm/wasmoon@1.16.0/+esm');
        }

        // Create Lua engine
        logToConsole('⚙️ Initializing Lua engine...');
        const factory = new window.wasmoonModule.LuaFactory();
        window.lua = await factory.createEngine();

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

        // Override Lua's print function to use app console
        window.lua.global.set('app_log', appLogToConsole);

        await window.lua.doString(`
-- Override print to use app console
_original_print = print
function print(...)
    local args = {...}
    local output = ""
    for i, v in ipairs(args) do
        if i > 1 then output = output .. "\\t" end
        output = output .. tostring(v)
    end
    app_log(output)
end
`);

        // Expose async sleep function to Lua
        window.lua.global.set('js_sleep', (ms) => {
            return new Promise(resolve => setTimeout(resolve, ms));
        });

        // Expose Chameleon Ultra BLE command function to Lua
        window.lua.global.set('chameleon_cmd', async (cmdNum, silent) => {
            const chameleon = window.ChameleonAPI?.chameleonUltra || window.chameleonUltra;

            if (!chameleon) {
                throw new Error('Not connected to Chameleon Ultra. Please connect via BLE first.');
            }

            const silentMode = silent !== undefined ? silent : true;
            const result = await chameleon.cmd(cmdNum, null, silentMode);

            if (result && result.data) {
                // Convert Uint8Array to Lua table
                const dataArray = Array.from(result.data);
                return {
                    cmd: result.cmd,
                    status: result.status,
                    data: dataArray
                };
            }
            return null;
        });

        // Add helper utilities to Lua
        await window.lua.doString(`
-- Helper constants
CMD_GET_BATTERY_INFO = 1025
CMD_GET_ACTIVE_SLOT = 1018
CMD_GET_SLOT_INFO = 1021

-- Helper to check if connected
function is_connected()
    -- This will be set from JavaScript side
    return js_connected == true
end

-- Quick battery check
function get_battery()
    local result = chameleon_cmd(CMD_GET_BATTERY_INFO, true)
    if result and result.data then
        local voltage = result.data[1] + (result.data[2] * 256)
        local percentage = result.data[3] or 0
        return {voltage = voltage, percentage = percentage}
    end
    return nil
end

-- Quick slot check
function get_active_slot()
    local result = chameleon_cmd(CMD_GET_ACTIVE_SLOT, true)
    if result and result.data then
        return result.data[1]
    end
    return nil
end

-- Helper to sleep (wrapper that awaits the promise)
function sleep(seconds)
    js_sleep(seconds * 1000)
end

print("✓ Chameleon Ultra Lua helpers loaded")
print("  - chameleon_cmd(cmd_num, silent)")
print("  - get_battery()")
print("  - get_active_slot()")
print("  - is_connected()")
print("  - sleep(seconds)")
`);

        // Set connection status
        const updateConnectionStatus = () => {
            const connected = !!(window.ChameleonAPI?.chameleonUltra || window.chameleonUltra);
            window.lua.global.set('js_connected', connected);
        };
        updateConnectionStatus();

        // Update connection status on device events
        if (API.on) {
            API.on('onDeviceConnected', () => {
                window.lua.global.set('js_connected', true);
            });
            API.on('onDeviceDisconnected', () => {
                window.lua.global.set('js_connected', false);
            });
        }

        window.luaReady = true;
        logToConsole('✅ Lua environment ready!');
        logToConsole('   Lua 5.4 loaded via WebAssembly');
        logToConsole('   Helper functions available');

    } catch (error) {
        logToConsole(`❌ Failed to load Lua: ${error.message}`, true);
        window.luaReady = false;
    } finally {
        window.luaLoading = false;
    }
}

// Register command to manually load Lua
API.registerCommand('lua-init', 'Initialize Lua environment', async () => {
    await initLuaEnvironment();
});

// Register command to check Lua status
API.registerCommand('lua-status', 'Show Lua status', async () => {
    logToConsole('🌙 Lua Status:');
    logToConsole(`  Ready: ${window.luaReady ? '✅' : '❌'}`);
    logToConsole(`  Loading: ${window.luaLoading ? '⏳ Yes' : 'No'}`);

    if (window.luaReady) {
        const version = await window.lua.doString('return _VERSION');
        logToConsole(`  Version: ${version}`);
    }
});

// Register command to run Lua one-liner
API.registerCommand('lua', 'Execute Lua code (e.g., lua print(2+2))', async (args) => {
    if (!window.luaReady) {
        logToConsole('⚠️ Lua not ready. Run "lua-init" first or wait for auto-load.', true);
        return;
    }

    if (args.length === 0) {
        logToConsole('Usage: lua <lua code>');
        logToConsole('Example: lua print(2 + 2)');
        return;
    }

    const code = args.join(' ');

    try {
        await window.lua.doString(code);
    } catch (error) {
        logToConsole(`❌ Lua Error: ${error.message}`, true);
    }
});

// Register Lua file runner
API.registerCommand('lua-run', 'Run Lua file from VFS (e.g., lua-run /scripts/test.lua)', async (args) => {
    if (!window.luaReady) {
        logToConsole('⚠️ Lua not ready. Run "lua-init" first or wait for auto-load.', true);
        return;
    }

    if (args.length === 0) {
        logToConsole('Usage: lua-run <filepath>');
        logToConsole('Example: lua-run /scripts/battery.lua');
        return;
    }

    const filepath = args[0];

    try {
        // Read file from VFS
        const luaCode = await API.fs.readFile(filepath);

        logToConsole(`🌙 Running ${filepath}...`);
        logToConsole('─'.repeat(60));

        // Run Lua code
        await window.lua.doString(luaCode);

        logToConsole('─'.repeat(60));
        logToConsole('✓ Script execution complete');
    } catch (error) {
        logToConsole(`❌ Error: ${error.message}`, true);
    }
});

// Hook into script execution to auto-detect .lua files
if (window.runFileFromFS) {
    const originalRunner = window.runFileFromFS;
    window.runFileFromFS = async function(path) {
        // If it's a .lua file, use Lua runner
        if (path.endsWith('.lua')) {
            if (!window.luaReady) {
                console.log('⚠️ Lua not ready. Waiting for initialization...');
                // Wait up to 30 seconds for Lua to load
                for (let i = 0; i < 60; i++) {
                    if (window.luaReady) break;
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                if (!window.luaReady) {
                    console.log('❌ Lua still not ready. Please run "lua-init" first.');
                    return;
                }
            }

            try {
                const luaCode = await API.fs.readFile(path);
                console.log(`🌙 Running Lua file: ${path}`);
                console.log('─'.repeat(60));

                await window.lua.doString(luaCode);

                console.log('─'.repeat(60));
                console.log('✓ Lua script completed');
            } catch (error) {
                console.log(`❌ Error: ${error.message}`);
                throw error;
            }
        } else {
            // Run normally for other files
            return originalRunner.call(this, path);
        }
    };
}

logToConsole(`✓ Extension loaded: ${extensionName}`);
logToConsole('  Commands: lua, lua-init, lua-status, lua-run');
logToConsole('  .lua files auto-detected in Script Editor');
logToConsole('  Starting Lua background load...');

// Auto-load Lua at startup (asynchronously, don't block)
(async () => {
    await initLuaEnvironment();
})().catch(err => {
    logToConsole(`❌ Async Lua load failed: ${err.message}`, true);
});
